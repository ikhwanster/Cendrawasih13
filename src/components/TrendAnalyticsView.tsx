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
  const safeZoneCount = Math.max(0, hotspots.length - highRiskZoneCount - watchZoneCount);

  return (
    <div className="space-y-5">
      {/* Reference Screen 8 Motif: Dark Organic Olive Header Banner + Overlapping Olive Summary Cards */}
      <section className="rounded-3xl overflow-hidden border border-[#cbe0b0] bg-white">
        <div className="bg-gradient-to-br from-[#263015] via-[#3c4b1a] to-[#586826] p-5 pb-10 text-[#f7f9f4] space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-base font-bold tracking-tight">
                Analisis Tren & Peta Rawan
              </h1>
              <p className="text-xs text-[#dcecc3]/85">
                Pemetaan kerawanan lokasi & waktu kejadian RW 013
              </p>
            </div>
          </div>

          <select
            aria-label="Filter Kategori Tren"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value as 'ALL' | ReportCategory)}
            className="w-full min-h-[42px] px-3.5 py-2 text-xs font-medium bg-[#f7f9f4] text-[#263015] rounded-full focus:outline-none focus:ring-2 focus:ring-[#a5cf4c]"
          >
            <option value="ALL">Semua Kategori Kejadian</option>
            {Object.values(CATEGORY_CATALOG).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {/* Overlapping Olive Summary Cards with Matcha Progress Bars (Screen 8) */}
        <div className="px-4 pb-4 -mt-6 space-y-2.5">
          <div className="bg-[#586826] text-[#f7f9f4] rounded-2xl p-4 shadow-sm space-y-2.5 border border-[#dcecc3]/25">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[#dcecc3]">Distribusi Zona Kerawanan RT</span>
              <span className="font-mono text-[#a5cf4c] font-bold">10 Wilayah RT</span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-[#48561e] rounded-xl p-2.5 space-y-0.5">
                <div className="flex items-center justify-center gap-1 text-[11px] text-red-200">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>Rawan</span>
                </div>
                <p className="text-xl font-bold font-mono tabular-nums">{highRiskZoneCount}</p>
              </div>
              <div className="bg-[#48561e] rounded-xl p-2.5 space-y-0.5">
                <div className="flex items-center justify-center gap-1 text-[11px] text-amber-200">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Waspada</span>
                </div>
                <p className="text-xl font-bold font-mono tabular-nums">{watchZoneCount}</p>
              </div>
              <div className="bg-[#48561e] rounded-xl p-2.5 space-y-0.5">
                <div className="flex items-center justify-center gap-1 text-[11px] text-[#a5cf4c]">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Aman</span>
                </div>
                <p className="text-xl font-bold font-mono tabular-nums">{safeZoneCount}</p>
              </div>
            </div>

            <div className="w-full h-2 rounded-full bg-[#3d4919] overflow-hidden">
              <div
                className="h-full rounded-full bg-[#a5cf4c]"
                style={{ width: `${Math.max(10, safeZoneCount * 10)}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Spatial Hotspot Map */}
      <section className="bg-white border border-[#cbe0b0] rounded-3xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-[#263015] flex items-center gap-1.5">
              <MapIcon className="w-4 h-4 text-[#586826]" />
              <span>Peta Spasial Zona Rawan</span>
            </h2>
            <p className="text-[11px] text-[#5b6649]">
              Radius lingkaran sesuai skor kerawanan tiap RT
            </p>
          </div>
          <span className="text-[11px] font-mono text-[#586826]">
            {filteredReports.length} titik
          </span>
        </div>

        <InteractiveMap
          center={mapCenter}
          zoom={15}
          heightClass="h-64"
          mode="explorer"
          reports={filteredReports}
          hotspots={hotspots}
          showHotspots={true}
          onSelectReport={onSelectReport}
        />

        <div className="flex items-center justify-center gap-3 text-[11px] text-[#5b6649]">
          <span>Merah: Rawan</span>
          <span aria-hidden="true">·</span>
          <span>Kuning: Waspada</span>
          <span aria-hidden="true">·</span>
          <span>Olive: Terkendali</span>
        </div>
      </section>

      {/* 14-Day Daily Incident Trend */}
      <section className="bg-[#dcecc3] border border-[#cbe0b0] rounded-3xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-[#263015]">Tren 14 Hari Terakhir</h2>
            <p className="text-[11px] text-[#5b6649]">
              Frekuensi laporan harian & proporsi darurat
            </p>
          </div>
          <span className="text-xs font-mono font-bold text-[#586826]">
            {filteredReports.length} lap
          </span>
        </div>

        <div className="bg-[#f7f9f4] border border-[#cbe0b0] rounded-2xl p-3.5 space-y-2">
          <div className="h-40 pt-3 flex items-end justify-between gap-1.5 border-b border-[#cbe0b0] pb-2">
            {dailySeries.map((day) => {
              const heightPct =
                day.count === 0 ? 5 : Math.max(14, Math.round((day.count / maxDailyCount) * 100));
              const urgentPct =
                day.count > 0 ? Math.round((day.urgentCount / day.count) * 100) : 0;
              return (
                <div
                  key={day.key}
                  className="flex-1 flex flex-col items-center justify-end h-full"
                  title={`${day.key}: ${day.count} laporan (${day.urgentCount} tinggi/darurat)`}
                >
                  <span className="text-[9px] font-mono tabular-nums text-[#5b6649] mb-0.5">
                    {day.count > 0 ? day.count : ''}
                  </span>
                  <div
                    className={`w-full max-w-5 rounded-t-md ${
                      day.count === 0 ? 'bg-[#e6f2d3]' : 'bg-[#586826]'
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
          <div className="flex items-center justify-between text-[9px] font-mono text-[#5b6649]">
            {dailySeries.map((day, idx) => (
              <span key={day.key} className={idx % 3 !== 0 ? 'hidden sm:inline' : ''}>
                {day.shortLabel}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Time-of-Day Windows & Category Share (Olive Card Style) */}
      <section className="bg-[#586826] text-[#f7f9f4] rounded-3xl p-4 space-y-4">
        <div>
          <h2 className="text-sm font-bold flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-[#a5cf4c]" />
            <span>Pola Jam Rawan Kejadian</span>
          </h2>
          <p className="text-[11px] text-[#dcecc3]/85">
            Intensitas waktu pelaporan warga untuk jadwal patroli
          </p>
        </div>

        <div className="space-y-3">
          {timeWindows.map((w) => (
            <div key={w.id} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[#f7f9f4]">{w.label}</span>
                <span className="font-mono tabular-nums text-[#dcecc3]">
                  {w.count} ({w.pct}%)
                </span>
              </div>
              <div className="w-full h-2 bg-[#48561e] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#a5cf4c] rounded-full"
                  style={{ width: `${Math.max(w.count > 0 ? 6 : 0, w.barWidth)}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="pt-3 border-t border-[#dcecc3]/20 space-y-2">
          <h3 className="text-xs font-bold text-[#dcecc3]">Distribusi Sektor Teratas</h3>
          {categoryBreakdown.slice(0, 4).map((cat) => (
            <div key={cat.id} className="flex items-center justify-between text-xs">
              <span className="text-[#f7f9f4] truncate pr-2">{cat.shortLabel}</span>
              <span className="font-mono tabular-nums text-[#a5cf4c] shrink-0">
                {cat.count} lap · {cat.resolved} tuntas
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* RT Vulnerability Ranking List */}
      <section className="bg-white border border-[#cbe0b0] rounded-3xl overflow-hidden">
        <div className="px-4 py-3.5 border-b border-[#cbe0b0] bg-[#e6f2d3]/60">
          <h2 className="text-xs font-bold text-[#263015]">
            Peringkat Skor Risiko 10 RT (RW 013)
          </h2>
          <p className="text-[11px] text-[#5b6649]">
            Urutan prioritas intervensi lapangan pengurus & dinas
          </p>
        </div>

        <div className="overflow-x-auto phone-scroll">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#cbe0b0] bg-[#f7f9f4] text-[#5b6649]">
                <th className="py-2.5 px-3 font-semibold">RT</th>
                <th className="py-2.5 px-2.5 font-semibold text-right">Aktif</th>
                <th className="py-2.5 px-2.5 font-semibold text-right">ABJ</th>
                <th className="py-2.5 px-2.5 font-semibold text-right">Skor</th>
                <th className="py-2.5 px-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e6f2d3]">
              {rankedHotspots.map((row) => (
                <tr key={row.id} className="hover:bg-[#f7f9f4]">
                  <td className="py-2.5 px-3 font-mono font-bold text-[#263015] whitespace-nowrap">
                    {row.rt}
                  </td>
                  <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-[#5b6649]">
                    {row.unresolvedCount}/{row.reportCount}
                  </td>
                  <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-[#5b6649]">
                    {row.abjPercent === null ? '–' : `${row.abjPercent}%`}
                  </td>
                  <td className="py-2.5 px-2.5 text-right font-mono tabular-nums font-bold text-[#263015]">
                    {row.riskScore}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {row.riskLevel === 'tinggi' ? (
                      <span className="font-bold text-red-700">Rawan</span>
                    ) : row.riskLevel === 'waspada' ? (
                      <span className="font-semibold text-amber-800">Waspada</span>
                    ) : (
                      <span className="font-medium text-[#586826]">Terkendali</span>
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
