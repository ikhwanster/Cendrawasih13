import React, { useEffect, useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  Globe,
  Loader2,
  Play,
  Webhook,
} from 'lucide-react';
import { auth } from '../firebase';
import type { AgencyDispatchItem } from '../types';
import { formatTimestamp } from '../utils/geoAndImage';

interface AgencyInfo {
  code: string;
  name: string;
  categories: string[];
  slaHours: number;
  protocol: string;
  endpointPath: string;
}

interface ApiIntegrationViewProps {
  dispatches: AgencyDispatchItem[];
}

const PRESET_ENDPOINTS = [
  {
    label: 'Feed Laporan GeoJSON (GIS Dinas PU / SDA)',
    path: '/api/v1/reports?format=geojson',
    requiresAuth: true,
  },
  {
    label: 'Feed Laporan JSON (Open311-ID)',
    path: '/api/v1/reports',
    requiresAuth: true,
  },
  {
    label: 'Rekapitulasi Laporan Per RT — 10 RT (Pengurus RW / Kelurahan)',
    path: '/api/v1/reports/by-rt',
    requiresAuth: true,
  },
  {
    label: 'Surveilans ABJ Jumantik RW 013 (Puskesmas)',
    path: '/api/v1/jumantik/summary',
    requiresAuth: true,
  },
  {
    label: 'Direktori Instansi Terhubung',
    path: '/api/v1/agencies',
    requiresAuth: false,
  },
  {
    label: 'Status Kesehatan Gateway API',
    path: '/api/v1/health',
    requiresAuth: false,
  },
];

export const ApiIntegrationView: React.FC<ApiIntegrationViewProps> = ({ dispatches }) => {
  const [agencies, setAgencies] = useState<AgencyInfo[]>([]);
  const [selectedEndpoint, setSelectedEndpoint] = useState(PRESET_ENDPOINTS[0].path);
  const [testing, setTesting] = useState(false);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [responseJson, setResponseJson] = useState<string>('');
  const [copiedCurl, setCopiedCurl] = useState(false);

  useEffect(() => {
    fetch('/api/v1/agencies')
      .then((r) => r.json())
      .then((d: { agencies?: AgencyInfo[] }) => {
        if (Array.isArray(d.agencies)) {
          setAgencies(d.agencies);
        }
      })
      .catch(() => {});
  }, []);

  const executeLiveApiRequest = async (endpointPath = selectedEndpoint) => {
    setTesting(true);
    const start = performance.now();
    try {
      const token = await auth.currentUser?.getIdToken();
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch(endpointPath, { headers });
      const elapsed = Math.round(performance.now() - start);
      const body = await res.json();
      setHttpStatus(res.status);
      setLatencyMs(elapsed);
      setResponseJson(JSON.stringify(body, null, 2));
    } catch (err) {
      setHttpStatus(500);
      setLatencyMs(Math.round(performance.now() - start));
      setResponseJson(
        JSON.stringify(
          { error: err instanceof Error ? err.message : 'Gagal menghubungi server API.' },
          null,
          2
        )
      );
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    executeLiveApiRequest(PRESET_ENDPOINTS[0].path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const originUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const curlSnippet = `curl -X GET "${originUrl}${selectedEndpoint}" \\\n  -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" \\\n  -H "Accept: application/json"`;

  const handleCopyCurl = async () => {
    try {
      await navigator.clipboard.writeText(curlSnippet);
      setCopiedCurl(true);
      setTimeout(() => setCopiedCurl(false), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  return (
    <div className="space-y-8">
      <div className="border-b border-slate-200 pb-5">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Integrasi Akses API Instansi Terkait
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Gateway interoperabilitas REST JSON, GeoJSON (RFC 7946), dan Webhook bertanda tangan HMAC-SHA256 untuk menghubungkan laporan warga & data Jumantik RW 013 dengan Puskesmas, Dinas PU, DLH, SDA, dan Satpol PP.
        </p>
      </div>

      {/* Connected Municipal Agencies Directory */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Globe className="w-4 h-4 text-slate-700" />
              <span>Katalog Instansi & Kontrak Endpoint</span>
            </h2>
            <p className="text-xs text-slate-500">
              Pemetaan otomatis kategori laporan ke endpoint konsumsi data instansi pemerintah daerah
            </p>
          </div>
          <span className="text-xs font-mono text-slate-500">{agencies.length} instansi aktif</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="py-2.5 px-4 font-semibold">Kode Instansi</th>
                <th className="py-2.5 px-4 font-semibold">Nama Instansi Terkait</th>
                <th className="py-2.5 px-4 font-semibold">Protokol Data</th>
                <th className="py-2.5 px-4 font-semibold text-right">Target SLA</th>
                <th className="py-2.5 px-4 font-semibold">Endpoint Integrasi</th>
                <th className="py-2.5 px-4 font-semibold text-right">Uji Langsung</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {agencies.map((ag) => (
                <tr key={ag.code} className="hover:bg-slate-50/80">
                  <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                    {ag.code}
                  </td>
                  <td className="py-3 px-4 text-slate-800">{ag.name}</td>
                  <td className="py-3 px-4 text-slate-600">{ag.protocol}</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                    {ag.slaHours} jam
                  </td>
                  <td className="py-3 px-4 font-mono text-[11px] text-slate-600">
                    {ag.endpointPath}
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedEndpoint(ag.endpointPath);
                        executeLiveApiRequest(ag.endpointPath);
                      }}
                      className="text-xs font-semibold text-slate-900 hover:underline cursor-pointer"
                    >
                      Jalankan GET
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Live Interactive API Console */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Code2 className="w-4 h-4 text-slate-700" />
              <span>Konsol Pengujian REST & GeoJSON</span>
            </h2>
            <p className="text-xs text-slate-500">
              Uji langsung endpoint server dengan token autentikasi sesi Anda saat ini.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="api-endpoint-select" className="block text-xs font-semibold text-slate-700">
              Pilih Endpoint API
            </label>
            <select
              id="api-endpoint-select"
              value={selectedEndpoint}
              onChange={(e) => setSelectedEndpoint(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              {PRESET_ENDPOINTS.map((ep) => (
                <option key={ep.path} value={ep.path}>
                  {ep.label} ({ep.path})
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => executeLiveApiRequest(selectedEndpoint)}
            disabled={testing}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
          >
            {testing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Memanggil Endpoint...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>Kirim Permintaan API Sekarang</span>
              </>
            )}
          </button>

          <div className="space-y-1.5 pt-2 border-t border-slate-200">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">Contoh Integrasi cURL</span>
              <button
                type="button"
                onClick={handleCopyCurl}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                {copiedCurl ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-700" />
                    <span className="text-emerald-700">Tersalin</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Salin</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-3 rounded-lg bg-slate-950 text-slate-100 text-[11px] font-mono overflow-x-auto leading-relaxed">
              {curlSnippet}
            </pre>
          </div>
        </div>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
            <span className="text-xs font-mono font-semibold text-slate-800 truncate">
              GET {selectedEndpoint}
            </span>
            {httpStatus !== null && (
              <span className="text-xs font-mono tabular-nums text-slate-600 shrink-0">
                HTTP{' '}
                <strong className={httpStatus < 400 ? 'text-emerald-700' : 'text-red-700'}>
                  {httpStatus}
                </strong>{' '}
                · {latencyMs} ms
              </span>
            )}
          </div>
          <pre className="p-4 bg-slate-950 text-slate-100 text-xs font-mono overflow-auto max-h-96 leading-relaxed">
            {responseJson || '// Menunggu respons dari server API...'}
          </pre>
        </div>
      </section>

      {/* Outbound Agency Dispatches Ledger */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Webhook className="w-4 h-4 text-slate-700" />
              <span>Riwayat Pengiriman Tiket API ke Instansi</span>
            </h2>
            <p className="text-xs text-slate-500">
              Log sinkronisasi laporan yang diteruskan dari Dashboard Admin ke instansi terkait
            </p>
          </div>
          <span className="text-xs font-mono text-slate-500">
            {dispatches.length} tiket tercatat
          </span>
        </div>

        {dispatches.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Belum ada pengiriman tiket instansi. Saat Admin menindaklanjuti laporan dengan opsi penerusan API, nomor referensi akan tercatat otomatis di sini.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="py-2.5 px-4 font-semibold">No. Referensi API</th>
                  <th className="py-2.5 px-4 font-semibold">Instansi Tujuan</th>
                  <th className="py-2.5 px-4 font-semibold">Ringkasan Payload</th>
                  <th className="py-2.5 px-4 font-semibold">Prioritas</th>
                  <th className="py-2.5 px-4 font-semibold">Status Integrasi</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Waktu Kirim</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dispatches.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {d.referenceNumber}
                    </td>
                    <td className="py-3 px-4 text-slate-800 whitespace-nowrap">{d.agencyName}</td>
                    <td className="py-3 px-4 text-slate-600 max-w-xs truncate">
                      {d.payloadSummary}
                    </td>
                    <td className="py-3 px-4 capitalize text-slate-700">{d.priority}</td>
                    <td className="py-3 px-4 font-medium text-emerald-700 capitalize">
                      {d.dispatchStatus.replace(/_/g, ' ')}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {formatTimestamp(d.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
