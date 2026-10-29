import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import type { Request, Response } from 'express';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId: string;
}

function loadFirebaseAppletConfig(): FirebaseAppletConfig {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'firebase-applet-config.json'), 'utf8');
    const parsed = JSON.parse(raw) as Partial<FirebaseAppletConfig>;
    return {
      projectId: parsed.projectId || '',
      firestoreDatabaseId: parsed.firestoreDatabaseId || '(default)',
    };
  } catch {
    return { projectId: '', firestoreDatabaseId: '(default)' };
  }
}

const AGENCIES = [
  {
    code: 'PUSKESMAS_RW013',
    name: 'Puskesmas Kelurahan & Kader Jumantik RW 013',
    categories: ['kesehatan_jentik'],
    slaHours: 12,
    protocol: 'REST JSON + GeoJSON + Surveilans ABJ',
    endpointPath: '/api/v1/jumantik/summary',
  },
  {
    code: 'DINAS_PU',
    name: 'Dinas Bina Marga & Pekerjaan Umum',
    categories: ['infrastruktur'],
    slaHours: 48,
    protocol: 'Open311-ID / GeoJSON RFC 7946',
    endpointPath: '/api/v1/reports?category=infrastruktur&format=geojson',
  },
  {
    code: 'DLH_KEBERSIHAN',
    name: 'Dinas Lingkungan Hidup (DLH)',
    categories: ['kebersihan'],
    slaHours: 24,
    protocol: 'Open311-ID / REST JSON',
    endpointPath: '/api/v1/reports?category=kebersihan',
  },
  {
    code: 'DINAS_SDA',
    name: 'Dinas Sumber Daya Air & Drainase',
    categories: ['drainase_banjir'],
    slaHours: 6,
    protocol: 'Emergency Webhook + GeoJSON',
    endpointPath: '/api/v1/reports?category=drainase_banjir&format=geojson',
  },
  {
    code: 'SATPOL_PP',
    name: 'Satpol PP & Bhabinkamtibmas Wilayah',
    categories: ['keamanan'],
    slaHours: 4,
    protocol: 'Priority Webhook HMAC-SHA256',
    endpointPath: '/api/v1/reports?category=keamanan',
  },
  {
    code: 'DISHUB_PJU',
    name: 'Dinas Perhubungan (Unit PJU & Fasilitas)',
    categories: ['fasilitas_umum'],
    slaHours: 36,
    protocol: 'Open311-ID / REST JSON',
    endpointPath: '/api/v1/reports?category=fasilitas_umum',
  },
];

// Simple in-memory cache for reverse geocoding to avoid rate limiting
const geocodeCache = new Map<string, { address: string; displayName: string; cachedAt: number }>();

function unwrapFirestoreValue(val: Record<string, unknown> | undefined): unknown {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('timestampValue' in val) return val.timestampValue;
  if ('nullValue' in val) return null;
  return null;
}

function parseFirestoreDoc(docObj: { name?: string; fields?: Record<string, Record<string, unknown>> }) {
  const id = docObj.name ? docObj.name.split('/').pop() || '' : '';
  const fields = docObj.fields || {};
  const result: Record<string, unknown> = { id };
  for (const [k, v] of Object.entries(fields)) {
    result[k] = unwrapFirestoreValue(v);
  }
  return result;
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  const fbConfig = loadFirebaseAppletConfig();

  app.use(express.json({ limit: '2mb' }));

  // 1. Health & OpenAPI Specification Summary
  app.get('/api/v1/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'SiagaWarga RW 013 Municipal API Gateway',
      version: '1.0.0',
      standards: ['Open311-ID', 'GeoJSON-RFC7946', 'HMAC-SHA256-Webhook'],
      projectId: fbConfig.projectId,
      timestamp: new Date().toISOString(),
      endpoints: [
        'GET /api/v1/health',
        'GET /api/v1/agencies',
        'GET /api/v1/geocode/reverse?lat={lat}&lng={lng}',
        'GET /api/v1/reports?category={cat}&status={status}&rt={rt}&format={json|geojson}',
        'GET /api/v1/reports/by-rt',
        'GET /api/v1/jumantik/summary',
        'POST /api/v1/webhooks/dispatch',
      ],
    });
  });

  // 2. Connected Municipal Agencies Directory
  app.get('/api/v1/agencies', (_req: Request, res: Response) => {
    res.json({
      count: AGENCIES.length,
      rwScope: 'RW 013',
      agencies: AGENCIES,
    });
  });

  // 3. Automatic Reverse Geocoding Proxy (OpenStreetMap Nominatim with caching)
  app.get('/api/v1/geocode/reverse', async (req: Request, res: Response) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      res.status(400).json({ error: 'Koordinat latitude/longitude tidak valid.' });
      return;
    }

    const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    const hit = geocodeCache.get(cacheKey);
    if (hit && Date.now() - hit.cachedAt < 1000 * 60 * 30) {
      res.json({ latitude: lat, longitude: lng, address: hit.address, displayName: hit.displayName, source: 'cache' });
      return;
    }

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
        String(lat)
      )}&lon=${encodeURIComponent(String(lng))}&zoom=18&addressdetails=1&accept-language=id`;

      const upstream = await fetch(url, {
        headers: {
          'User-Agent': 'SiagaWarga-RW013-CivicApp/1.0 (Civic Reporting Integration)',
          Accept: 'application/json',
        },
      });

      if (!upstream.ok) {
        const fallback = `Titik Koordinat (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
        res.json({ latitude: lat, longitude: lng, address: fallback, displayName: fallback, source: 'coordinates' });
        return;
      }

      const data = (await upstream.json()) as {
        display_name?: string;
        address?: Record<string, string>;
      };

      const addr = data.address || {};
      const parts = [
        addr.road || addr.pedestrian || addr.residential || addr.hamlet,
        addr.neighbourhood || addr.suburb || addr.village,
        addr.city_district || addr.municipality || addr.city || addr.county,
        addr.state,
      ].filter(Boolean);

      const conciseAddress = (parts.length > 0 ? parts.join(', ') : data.display_name || `Koordinat ${lat.toFixed(5)}, ${lng.toFixed(5)}`).slice(0, 280);
      const fullDisplay = (data.display_name || conciseAddress).slice(0, 295);

      geocodeCache.set(cacheKey, {
        address: conciseAddress,
        displayName: fullDisplay,
        cachedAt: Date.now(),
      });

      res.json({
        latitude: lat,
        longitude: lng,
        address: conciseAddress,
        displayName: fullDisplay,
        source: 'nominatim',
      });
    } catch {
      const fallback = `Titik GPS (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
      res.json({ latitude: lat, longitude: lng, address: fallback, displayName: fallback, source: 'fallback' });
    }
  });

  // 4. Standardized Reports Feed for Municipal Agencies (JSON & GeoJSON)
  app.get('/api/v1/reports', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Diperlukan header Authorization: Bearer <Firebase_ID_Token> untuk mengakses data laporan instansi.',
      });
      return;
    }

    if (!fbConfig.projectId) {
      res.status(500).json({ error: 'Konfigurasi proyek Firebase belum ditemukan.' });
      return;
    }

    const categoryFilter = typeof req.query.category === 'string' ? req.query.category : '';
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : '';
    const rtFilter = typeof req.query.rt === 'string' ? req.query.rt : '';
    const format = req.query.format === 'geojson' ? 'geojson' : 'json';
    const includePhoto = req.query.includePhoto === 'true';

    try {
      const runQueryUrl = `https://firestore.googleapis.com/v1/projects/${fbConfig.projectId}/databases/${fbConfig.firestoreDatabaseId}/documents:runQuery`;

      const structuredQuery = {
        from: [{ collectionId: 'reports' }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              {
                fieldFilter: {
                  field: { fieldPath: 'rwCode' },
                  op: 'EQUAL',
                  value: { stringValue: 'RW013' },
                },
              },
              {
                fieldFilter: {
                  field: { fieldPath: 'visibility' },
                  op: 'EQUAL',
                  value: { stringValue: 'public' },
                },
              },
            ],
          },
        },
        limit: 100,
      };

      const firestoreRes = await fetch(runQueryUrl, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ structuredQuery }),
      });

      if (!firestoreRes.ok) {
        const errBody = await firestoreRes.text();
        res.status(firestoreRes.status).json({
          error: 'Gagal mengambil laporan dari Firestore.',
          details: errBody.slice(0, 300),
        });
        return;
      }

      const rawRows = (await firestoreRes.json()) as Array<{
        document?: { name?: string; fields?: Record<string, Record<string, unknown>> };
      }>;

      let items = rawRows
        .filter((r) => Boolean(r.document))
        .map((r) => parseFirestoreDoc(r.document!));

      if (categoryFilter) {
        items = items.filter((item) => item.category === categoryFilter);
      }
      if (statusFilter) {
        items = items.filter((item) => item.status === statusFilter);
      }
      if (rtFilter) {
        items = items.filter((item) => item.rt === rtFilter);
      }

      const sanitized = items.map((item) => {
        const hasPhoto = typeof item.photoDataUrl === 'string' && item.photoDataUrl.length > 0;
        const copy: Record<string, unknown> = {
          id: item.id,
          title: item.title,
          description: item.description,
          category: item.category,
          urgency: item.urgency,
          status: item.status,
          rt: item.rt,
          rwCode: item.rwCode,
          latitude: item.latitude,
          longitude: item.longitude,
          address: item.address,
          assignedAgency: item.assignedAgency,
          adminNote: item.adminNote,
          hasPhoto,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
        if (includePhoto) {
          copy.photoDataUrl = item.photoDataUrl;
        }
        return copy;
      });

      if (format === 'geojson') {
        res.json({
          type: 'FeatureCollection',
          metadata: {
            source: 'SiagaWarga RW 013',
            generatedAt: new Date().toISOString(),
            count: sanitized.length,
          },
          features: sanitized.map((rep) => ({
            type: 'Feature',
            id: rep.id,
            geometry: {
              type: 'Point',
              coordinates: [Number(rep.longitude) || 0, Number(rep.latitude) || 0],
            },
            properties: rep,
          })),
        });
        return;
      }

      res.json({
        meta: {
          rwScope: 'RW 013',
          count: sanitized.length,
          generatedAt: new Date().toISOString(),
        },
        data: sanitized,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Kesalahan internal server API.',
      });
    }
  });

  // 4b. 10-RT Comparative Report Recap Endpoint (RT 001 – RT 010)
  app.get('/api/v1/reports/by-rt', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Diperlukan header Authorization: Bearer <Firebase_ID_Token> untuk mengakses rekap 10 RT.',
      });
      return;
    }

    try {
      const runQueryUrl = `https://firestore.googleapis.com/v1/projects/${fbConfig.projectId}/databases/${fbConfig.firestoreDatabaseId}/documents:runQuery`;
      const structuredQuery = {
        from: [{ collectionId: 'reports' }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              {
                fieldFilter: {
                  field: { fieldPath: 'rwCode' },
                  op: 'EQUAL',
                  value: { stringValue: 'RW013' },
                },
              },
              {
                fieldFilter: {
                  field: { fieldPath: 'visibility' },
                  op: 'EQUAL',
                  value: { stringValue: 'public' },
                },
              },
            ],
          },
        },
        limit: 200,
      };

      const firestoreRes = await fetch(runQueryUrl, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ structuredQuery }),
      });

      if (!firestoreRes.ok) {
        const errBody = await firestoreRes.text();
        res.status(firestoreRes.status).json({
          error: 'Gagal mengambil rekap laporan 10 RT dari Firestore.',
          details: errBody.slice(0, 300),
        });
        return;
      }

      const rawRows = (await firestoreRes.json()) as Array<{
        document?: { name?: string; fields?: Record<string, Record<string, unknown>> };
      }>;

      const items = rawRows
        .filter((r) => Boolean(r.document))
        .map((r) => parseFirestoreDoc(r.document!));

      const rtList = [
        'RT 001', 'RT 002', 'RT 003', 'RT 004', 'RT 005',
        'RT 006', 'RT 007', 'RT 008', 'RT 009', 'RT 010',
      ];

      const summaryByRt = rtList.map((rtUnit) => {
        const subset = items.filter((i) => i.rt === rtUnit);
        const active = subset.filter((i) => i.status !== 'selesai' && i.status !== 'ditolak').length;
        const completed = subset.filter((i) => i.status === 'selesai').length;
        const urgent = subset.filter((i) => i.urgency === 'tinggi' || i.urgency === 'darurat').length;
        const byCategory: Record<string, number> = {};
        for (const r of subset) {
          const c = String(r.category || 'lainnya');
          byCategory[c] = (byCategory[c] || 0) + 1;
        }
        return {
          rt: rtUnit,
          totalReports: subset.length,
          activeReports: active,
          completedReports: completed,
          highOrEmergencyReports: urgent,
          byCategory,
        };
      });

      res.json({
        rwScope: 'RW 013',
        totalRtUnits: 10,
        totalReports: items.length,
        generatedAt: new Date().toISOString(),
        perRt: summaryByRt,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Kesalahan internal server API.',
      });
    }
  });

  // 5. Surveilans Kampung Bebas Jentik (ABJ RW 013) Endpoint for Puskesmas / Dinkes
  app.get('/api/v1/jumantik/summary', async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Diperlukan header Authorization: Bearer <Firebase_ID_Token> untuk mengakses data ABJ RW 013.',
      });
      return;
    }

    try {
      const runQueryUrl = `https://firestore.googleapis.com/v1/projects/${fbConfig.projectId}/databases/${fbConfig.firestoreDatabaseId}/documents:runQuery`;
      const structuredQuery = {
        from: [{ collectionId: 'jumantikLogs' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'rwCode' },
            op: 'EQUAL',
            value: { stringValue: 'RW013' },
          },
        },
        limit: 200,
      };

      const firestoreRes = await fetch(runQueryUrl, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ structuredQuery }),
      });

      if (!firestoreRes.ok) {
        const errBody = await firestoreRes.text();
        res.status(firestoreRes.status).json({
          error: 'Gagal membaca rekap Jumantik dari Firestore.',
          details: errBody.slice(0, 300),
        });
        return;
      }

      const rawRows = (await firestoreRes.json()) as Array<{
        document?: { name?: string; fields?: Record<string, Record<string, unknown>> };
      }>;

      const logs = rawRows
        .filter((r) => Boolean(r.document))
        .map((r) => parseFirestoreDoc(r.document!));

      let totalInspected = 0;
      let totalWithLarvae = 0;
      const byRt: Record<string, { housesInspected: number; housesWithLarvae: number; abjPercent: number }> = {};

      for (const log of logs) {
        const inspected = Number(log.housesInspected) || 0;
        const positive = Number(log.housesWithLarvae) || 0;
        const rt = String(log.rt || 'RT 001');
        totalInspected += inspected;
        totalWithLarvae += positive;

        if (!byRt[rt]) {
          byRt[rt] = { housesInspected: 0, housesWithLarvae: 0, abjPercent: 100 };
        }
        byRt[rt].housesInspected += inspected;
        byRt[rt].housesWithLarvae += positive;
      }

      for (const rt of Object.keys(byRt)) {
        const entry = byRt[rt];
        entry.abjPercent =
          entry.housesInspected > 0
            ? Number((((entry.housesInspected - entry.housesWithLarvae) / entry.housesInspected) * 100).toFixed(1))
            : 0;
      }

      const cumulativeAbj =
        totalInspected > 0
          ? Number((((totalInspected - totalWithLarvae) / totalInspected) * 100).toFixed(1))
          : null;

      res.json({
        program: 'Kampung Bebas Jentik – RW 013',
        kemenkesTargetPercent: 95.0,
        cumulativeAbjPercent: cumulativeAbj,
        status: cumulativeAbj === null ? 'belum_ada_data' : cumulativeAbj >= 95 ? 'bebas_jentik' : 'waspada_dbd',
        totalInspections: logs.length,
        totalHousesInspected: totalInspected,
        totalHousesWithLarvae: totalWithLarvae,
        perRt: byRt,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Gagal memproses ringkasan ABJ.',
      });
    }
  });

  // 6. Signed Outbound Agency Webhook Dispatch Relay
  app.post('/api/v1/webhooks/dispatch', async (req: Request, res: Response) => {
    const { reportId, agencyCode, priority, summary, webhookUrl } = req.body as {
      reportId?: string;
      agencyCode?: string;
      priority?: string;
      summary?: string;
      webhookUrl?: string;
    };

    const agency = AGENCIES.find((a) => a.code === agencyCode);
    if (!reportId || !agency) {
      res.status(400).json({ error: 'reportId dan agencyCode yang valid wajib disertakan.' });
      return;
    }

    const referenceNumber = `DISP-RW013-${Date.now().toString(36).toUpperCase()}`;
    const payload = {
      event: 'citizen_report.dispatched',
      referenceNumber,
      reportId,
      agencyCode: agency.code,
      agencyName: agency.name,
      priority: priority || 'normal',
      summary: (summary || '').slice(0, 480),
      dispatchedAt: new Date().toISOString(),
    };

    const signingKey = process.env.WEBHOOK_SIGNING_SECRET || 'siagawarga-rw013-public-verifier';
    const signature = crypto
      .createHmac('sha256', signingKey)
      .update(JSON.stringify(payload))
      .digest('hex');

    let externalDeliveryStatus = 'queued_internal_gateway';
    if (webhookUrl && /^https?:\/\//i.test(webhookUrl)) {
      try {
        const extRes = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-SiagaWarga-Signature': `sha256=${signature}`,
            'X-SiagaWarga-Reference': referenceNumber,
          },
          body: JSON.stringify(payload),
        });
        externalDeliveryStatus = `delivered_http_${extRes.status}`;
      } catch {
        externalDeliveryStatus = 'webhook_unreachable_logged';
      }
    }

    res.json({
      ok: true,
      referenceNumber,
      signature: `sha256=${signature}`,
      delivery: externalDeliveryStatus,
      payload,
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SiagaWarga RW 013 server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
