import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Map as MapIcon, ShieldAlert } from 'lucide-react';
import {
  CATEGORY_CATALOG,
  type CitizenReport,
  type JumantikLog,
  type ReportCategory,
} from '../types';
import {
  computeRtVulnerability,
  DEFAULT_RW013_CENTER,
  timestampToMillis,
} from '../utils/geoAndImage';
import { InteractiveMap } from './InteractiveMap';

interface TrendAnalyticsViewProps {
  reports: CitizenReport[];
  jumantikLogs: JumantikLog[];
  onSelectReport: (report: CitizenReport) => void;
}

export const TrendAnalyticsView: React.FC<TrendAnalyticsViewProps> = ({
  reports,
  jumantikLogs,
  onSelectReport,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<'ALL' | ReportCategory>('ALL');

  const filteredReports = useMemo(() => {
    if (selectedCategory === 'ALL') return reports;
    return reports.filter((r) => r.category === selectedCategory);
  }, [reports, selectedCategory]);

  const hotspots = useMemo(
    () => computeRtVulnerability(filteredReports, jumantikLogs),
    [filteredReports, jumantikLogs]
  );

  const rankedHotspots = useMemo(
    () => [...hotspots].sort((a, b) => b.riskScore - a.riskScore),
    [hotspots]
  );

  const mapCenter = useMemo(() => {
    const firstActive = rankedHotspots.find((h) => h.reportCount > 0);
    if (firstActive) {
      return { lat: firstActive.lat, lng: firstActive.lng };
    }
    return DEFAULT_RW013_CENTER;
  }, [rankedHotspots]);

  // Temporal Window Analysis (Time of Day)
  const timeWindows = useMemo(() => {
    const buckets = [
      { id: 'pagi', label: 'Pagi (06:00–11:59)', count: 0 },
      { id: 'siang', label: 'Siang (12:00–14:59)', count: 0 },
      { id: 'sore', label: 'Sore (15:00–18:59)', count: 0 },
      { id: 'malam', label: 'Malam (19:00–05:59)', count: 0 },
    ];
    for (const r of filteredReports) {
      const hour = new Date(timestampToMillis(r.createdAt)).getHours();
      if (hour >= 6 && hour < 12) buckets[0].count += 1;
      else if (hour >= 12 && hour < 15) buckets[1].count += 1;
      else if (hour >= 15 && hour < 19) buckets[2].count += 1;
      else buckets[3].count += 1;
    }
    const max = Math.max(1, ...buckets.map((b) => b.count));
    return buckets.map((b) => ({
      ...b,
      pct: Math.round((b.count / Math.max(1, filteredReports.length)) * 100),
      barWidth: Math.round((b.count / max) * 100),
    }));
  }, [filteredReports]);

  // 14-Day Daily Incident Trend
  const dailySeries = useMemo(() => {
    const days: Array<{ key: string; shortLabel: string; count: number; urgentCount: number }> = [];
    const now = new Date();
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const shortLabel = `${String(d.getDate()).padStart(2, '0')}/${String(
        d.getMonth() + 1
      ).padStart(2, '0')}`;
      days.push({ key: iso, shortLabel, count: 0, urgentCount: 0 });
    }

    const indexByDate = new Map(days.map((d, i) => [d.key, i]));
    for (const r of filteredReports) {
      const dateIso = new Date(timestampToMillis(r.createdAt)).toISOString().slice(0, 10);
      const idx = indexByDate.get(dateIso);
      if (idx !== undefined) {
        days[idx].count += 1;
        if (r.urgency === 'tinggi' || r.urgency === 'darurat') {
          days[idx].urgentCount += 1;
        }
      }
    }
    return days;
  }, [filteredReports]);

  const maxDailyCount = Math.max(1, ...dailySeries.map((d) => d.count));

  // Category Breakdown
  const categoryBreakdown = useMemo(() => {
    const total = Math.max(1, reports.length);
    return Object.values(CATEGORY_CATALOG)
      .map((cat) => {
        const catReports = reports.filter((r) => r.category === cat.id);
        const resolved = catReports.filter((r) => r.status === 'selesai').length;
        return {
          ...cat,
          count: catReports.length,
          resolved,
          sharePct: Math.round((catReports.length / total) * 100),
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [reports]);

  const highRiskZoneCount = hotspots.filter((h) => h.riskLevel === 'tinggi').length;
  const watchZoneCount = hotspots.filter((h) => h.riskLevel === 'waspada').length;

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Analisis Tren & Pemetaan Area Rawan
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Pemetaan spasial titik rawan berdasarkan frekuensi laporan, tingkat urgensi, pola waktu kejadian, serta indeks jentik (ABJ) per RT.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="trend-cat-filter" className="text-xs font-medium text-slate-600">
            Filter Kategori:
          </label>
          <select
            id="trend-cat-filter"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value as 'ALL' | ReportCategory)}
            className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            <option value="ALL">Semua Kategori Kejadian</option>
            {Object.values(CATEGORY_CATALOG).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Top Vulnerability Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Zona Risiko Tinggi (Prioritas Intervensi)</span>
            <ShieldAlert className="w-4 h-4 text-red-700" />
          </div>
          <p className="text-3xl font-bold font-mono tabular-nums text-red-700">
            {highRiskZoneCount}{' '}
            <span className="text-sm font-normal text-slate-500">Wilayah RT</span>
          </p>
          <p className="text-xs text-slate-500">
            Skor komposit ≥ 18, laporan darurat berulang, atau ABJ &lt; 90%
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Zona Waspada Pemantauan</span>
            <AlertTriangle className="w-4 h-4 text-amber-700" />
          </div>
          <p className="text-3xl font-bold font-mono tabular-nums text-amber-700">
            {watchZoneCount}{' '}
            <span className="text-sm font-normal text-slate-500">Wilayah RT</span>
          </p>
          <p className="text-xs text-slate-500">
            Terdapat laporan aktif belum tuntas atau ABJ antara 90%–94,9%
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Zona Terkendali</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-700" />
          </div>
          <p className="text-3xl font-bold font-mono tabular-nums text-emerald-700">
            {Math.max(0, hotspots.length - highRiskZoneCount - watchZoneCount)}{' '}
            <span className="text-sm font-normal text-slate-500">Wilayah RT</span>
          </p>
          <p className="text-xs text-slate-500">
            Lingkungan kondusif tanpa antrean insiden kritis
          </p>
        </div>
      </div>

      {/* Spatial Hotspot Map */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <MapIcon className="w-4 h-4 text-slate-700" />
              <span>Peta Spasial Area Rawan & Sebaran Titik Kejadian</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Radius lingkaran merepresentasikan indeks kerawanan komposit tiap RT. Klik lingkaran atau pin untuk rincian.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-600">
            <span>Merah: Risiko Tinggi</span>
            <span aria-hidden="true">·</span>
            <span>Kuning: Waspada</span>
            <span aria-hidden="true">·</span>
            <span>Hijau: Terkendali</span>
          </div>
        </div>

        <InteractiveMap
          center={mapCenter}
          zoom={15}
          heightClass="h-[420px]"
          mode="explorer"
          reports={filteredReports}
          hotspots={hotspots}
          showHotspots={true}
          onSelectReport={onSelectReport}
        />
      </section>

      {/* Temporal Analysis: 14-Day Trend + Time-of-Day Windows */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Tren Frekuensi Laporan (14 Hari Terakhir)
              </h2>
              <p className="text-xs text-slate-500">
                Jumlah laporan harian beserta proporsi insiden berurgensi tinggi/darurat
              </p>
            </div>
            <span className="text-xs font-mono text-slate-500">
              Total: {filteredReports.length} laporan
            </span>
          </div>

          <div className="h-52 pt-4 flex items-end justify-between gap-2 border-b border-slate-200 pb-2">
            {dailySeries.map((day) => {
              const heightPct = day.count === 0 ? 4 : Math.max(12, Math.round((day.count / maxDailyCount) * 100));
              const urgentPct =
                day.count > 0 ? Math.round((day.urgentCount / day.count) * 100) : 0;
              return (
                <div
                  key={day.key}
                  className="flex-1 flex flex-col items-center justify-end h-full group"
                  title={`${day.key}: ${day.count} laporan (${day.urgentCount} tinggi/darurat)`}
                >
                  <span className="text-[10px] font-mono tabular-nums text-slate-500 mb-1">
                    {day.count > 0 ? day.count : ''}
                  </span>
                  <div
                    className={`w-full max-w-7 rounded-t transition-opacity ${
                      day.count === 0 ? 'bg-slate-100' : 'bg-slate-800 group-hover:opacity-85'
                    } relative overflow-hidden`}
                    style={{ height: `${heightPct}%` }}
                  >
                    {urgentPct > 0 && (
                      <div
                        className="w-full bg-red-600 absolute bottom-0 left-0"
                        style={{ height: `${urgentPct}%` }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
            {dailySeries.map((day, idx) => (
              <span key={day.key} className={idx % 2 === 1 ? 'hidden sm:inline' : ''}>
                {day.shortLabel}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500 pt-1">
            <span>Batang Gelap: Laporan Reguler</span>
            <span aria-hidden="true">·</span>
            <span className="text-red-700 font-medium">Segmen Merah: Urgensi Tinggi / Darurat</span>
          </div>
        </div>

        {/* Time-of-Day Pattern & Category Share */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-700" />
              <span>Pola Waktu Rawan Kejadian</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Rentang jam dengan intensitas pelaporan tertinggi untuk penjadwalan patroli & petugas
            </p>
          </div>

          <div className="space-y-3.5">
            {timeWindows.map((w) => (
              <div key={w.id} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-800">{w.label}</span>
                  <span className="font-mono tabular-nums text-slate-600">
                    {w.count} laporan ({w.pct}%)
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-slate-900 rounded-full"
                    style={{ width: `${Math.max(w.count > 0 ? 6 : 0, w.barWidth)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-slate-200 space-y-2.5">
            <h3 className="text-xs font-semibold text-slate-700">
              Distribusi Kategori & Tingkat Penyelesaian
            </h3>
            {categoryBreakdown.slice(0, 4).map((cat) => (
              <div key={cat.id} className="flex items-center justify-between text-xs">
                <span className="text-slate-700 truncate pr-2">{cat.shortLabel}</span>
                <span className="font-mono tabular-nums text-slate-600 shrink-0">
                  {cat.count} masuk · {cat.resolved} selesai ({cat.sharePct}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RT Vulnerability Matrix Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">
            Matriks Peringkat Kerawanan Wilayah per RT (RW 013)
          </h2>
          <p className="text-xs text-slate-500">
            Diurutkan berdasarkan skor risiko tertinggi untuk membantu pengurus RW & instansi memprioritaskan tindak lanjut lapangan.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="py-3 px-4 font-semibold">Wilayah RT</th>
                <th className="py-3 px-4 font-semibold text-right">Total Laporan</th>
                <th className="py-3 px-4 font-semibold text-right">Belum Selesai</th>
                <th className="py-3 px-4 font-semibold text-right">Tinggi / Darurat</th>
                <th className="py-3 px-4 font-semibold text-right">ABJ Jentik</th>
                <th className="py-3 px-4 font-semibold">Isu Dominan</th>
                <th className="py-3 px-4 font-semibold text-right">Skor Risiko</th>
                <th className="py-3 px-4 font-semibold">Status Wilayah</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rankedHotspots.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/80">
                  <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">
                    {row.rt}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                    {row.reportCount}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                    {row.unresolvedCount}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                    {row.highUrgencyCount}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                    {row.abjPercent === null ? '–' : `${row.abjPercent}%`}
                  </td>
                  <td className="py-2.5 px-4 text-slate-700">
                    {row.reportCount > 0
                      ? CATEGORY_CATALOG[row.dominantCategory as ReportCategory]?.shortLabel ||
                        row.dominantCategory
                      : '–'}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                    {row.riskScore}
                  </td>
                  <td className="py-2.5 px-4">
                    {row.riskLevel === 'tinggi' ? (
                      <span className="font-semibold text-red-700">Prioritas Tinggi (Rawan)</span>
                    ) : row.riskLevel === 'waspada' ? (
                      <span className="font-medium text-amber-700">Waspada</span>
                    ) : (
                      <span className="text-emerald-700">Terkendali</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
