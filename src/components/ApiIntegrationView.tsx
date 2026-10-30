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
    label: 'Rekapitulasi Laporan 10 RT (Kelurahan)',
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
    <div className="space-y-5">
      {/* Olive Interoperability Header */}
      <section className="bg-[#586826] text-[#f7f9f4] rounded-3xl p-5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-bold flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#a5cf4c]" />
            <span>Gateway API Instansi Terkait</span>
          </h1>
          <span className="text-xs font-mono text-[#a5cf4c]">{agencies.length} dinas</span>
        </div>
        <p className="text-xs text-[#dcecc3]/90 leading-relaxed">
          Interoperabilitas REST JSON, GeoJSON (RFC 7946), rekap 10 RT, dan Webhook HMAC-SHA256 untuk Puskesmas, Dinas PU, DLH, SDA, dan Satpol PP.
        </p>
      </section>

      {/* Connected Municipal Agencies Cards */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-bold text-[#263015]">Katalog Instansi & Endpoint</h2>
          <span className="text-[11px] text-[#5b6649]">Ketuk Uji untuk panggil API</span>
        </div>

        <div className="space-y-2">
          {agencies.map((ag) => (
            <div
              key={ag.code}
              className="bg-white border border-[#cbe0b0] rounded-2xl p-3.5 flex items-center justify-between gap-3"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="text-xs font-bold text-[#263015] truncate">{ag.name}</p>
                <p className="text-[11px] text-[#5b6649] truncate">
                  {ag.protocol} · SLA {ag.slaHours}j
                </p>
                <p className="text-[10px] font-mono text-[#586826] truncate">{ag.endpointPath}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedEndpoint(ag.endpointPath);
                  executeLiveApiRequest(ag.endpointPath);
                }}
                className="min-h-[38px] px-3.5 py-1.5 text-xs font-semibold text-[#f7f9f4] bg-[#586826] rounded-full hover:bg-[#48561e] shrink-0 cursor-pointer whitespace-nowrap"
              >
                Uji GET
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Live Interactive API Console */}
      <section className="bg-[#dcecc3] border border-[#cbe0b0] rounded-3xl p-4 space-y-3.5">
        <div className="space-y-0.5">
          <h2 className="text-xs font-bold text-[#263015] flex items-center gap-1.5">
            <Code2 className="w-4 h-4 text-[#586826]" />
            <span>Konsol Pengujian REST & GeoJSON</span>
          </h2>
          <p className="text-[11px] text-[#5b6649]">
            Menggunakan Bearer Token sesi autentikasi Anda secara langsung
          </p>
        </div>

        <select
          aria-label="Pilih Endpoint API"
          value={selectedEndpoint}
          onChange={(e) => setSelectedEndpoint(e.target.value)}
          className="w-full min-h-[42px] px-3.5 py-2 text-xs bg-white border border-[#cbe0b0] rounded-xl text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
        >
          {PRESET_ENDPOINTS.map((ep) => (
            <option key={ep.path} value={ep.path}>
              {ep.label} ({ep.path})
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => executeLiveApiRequest(selectedEndpoint)}
          disabled={testing}
          className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-[#f7f9f4] bg-[#586826] rounded-full hover:bg-[#48561e] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50"
        >
          {testing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Memanggil Endpoint...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              <span>Kirim Permintaan API</span>
            </>
          )}
        </button>

        {/* Response Output */}
        <div className="rounded-2xl overflow-hidden border border-[#586826]/40 bg-[#263015]">
          <div className="px-3.5 py-2 border-b border-[#586826]/40 flex items-center justify-between text-[11px] font-mono text-[#dcecc3]">
            <span className="truncate">GET {selectedEndpoint}</span>
            {httpStatus !== null && (
              <span className="shrink-0 text-[#a5cf4c]">
                HTTP {httpStatus} · {latencyMs}ms
              </span>
            )}
          </div>
          <pre className="p-3.5 text-[#f7f9f4] text-[11px] font-mono overflow-auto max-h-60 leading-relaxed phone-scroll">
            {responseJson || 'Menunggu respons server API...'}
          </pre>
        </div>

        {/* cURL Snippet */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[#263015]">Perintah cURL Instansi</span>
            <button
              type="button"
              onClick={handleCopyCurl}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#586826] cursor-pointer"
            >
              {copiedCurl ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Tersalin</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Salin</span>
                </>
              )}
            </button>
          </div>
          <pre className="p-3 rounded-2xl bg-[#263015] text-[#dcecc3] text-[10px] font-mono overflow-x-auto leading-relaxed">
            {curlSnippet}
          </pre>
        </div>
      </section>

      {/* Outbound Agency Dispatches Ledger */}
      <section className="bg-white border border-[#cbe0b0] rounded-3xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-bold text-[#263015] flex items-center gap-1.5">
              <Webhook className="w-4 h-4 text-[#586826]" />
              <span>Riwayat Pengiriman Tiket API</span>
            </h2>
            <p className="text-[11px] text-[#5b6649]">
              Tiket laporan yang diteruskan ke instansi terkait
            </p>
          </div>
          <span className="text-[11px] font-mono font-bold text-[#586826]">
            {dispatches.length} tiket
          </span>
        </div>

        {dispatches.length === 0 ? (
          <div className="py-5 text-center text-xs text-[#5b6649]">
            Belum ada tiket instansi terkirim dari Dashboard Admin.
          </div>
        ) : (
          <div className="space-y-2">
            {dispatches.map((d) => (
              <div
                key={d.id}
                className="bg-[#f7f9f4] border border-[#cbe0b0] rounded-2xl p-3 space-y-1 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold text-[#263015] truncate">
                    {d.referenceNumber}
                  </span>
                  <span className="font-semibold text-[#586826] capitalize shrink-0">
                    {d.dispatchStatus.replace(/_/g, ' ')}
                  </span>
                </div>
                <p className="text-[#263015] font-medium truncate">{d.agencyName}</p>
                <p className="text-[11px] text-[#5b6649] truncate">{d.payloadSummary}</p>
                <div className="flex items-center justify-between text-[10px] font-mono text-[#5b6649] pt-0.5">
                  <span className="uppercase">Prioritas {d.priority}</span>
                  <span>{formatTimestamp(d.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
