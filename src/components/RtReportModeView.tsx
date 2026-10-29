import React, { useMemo, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Download,
  MapPin,
  Plus,
  Search,
} from 'lucide-react';
import {
  CATEGORY_CATALOG,
  RT_UNITS,
  STATUS_LABELS,
  URGENCY_LABELS,
  type CitizenReport,
  type JumantikLog,
  type ReportCategory,
  type RtUnit,
} from '../types';
import {
  computeRtVulnerability,
  DEFAULT_RW013_CENTER,
  formatTimestamp,
} from '../utils/geoAndImage';
import { InteractiveMap } from './InteractiveMap';

interface RtReportModeViewProps {
  reports: CitizenReport[];
  jumantikLogs: JumantikLog[];
  initialRt?: RtUnit;
  onSelectReport: (report: CitizenReport) => void;
  onCreateReportForRt: (rt: RtUnit) => void;
}

export const RtReportModeView: React.FC<RtReportModeViewProps> = ({
  reports,
  jumantikLogs,
  initialRt = 'RT 001',
  onSelectReport,
  onCreateReportForRt,
}) => {
  const [selectedRt, setSelectedRt] = useState<RtUnit>(
    RT_UNITS.includes(initialRt) ? initialRt : 'RT 001'
  );
  const [statusScope, setStatusScope] = useState<'ALL' | 'ACTIVE' | 'DONE'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const hotspots = useMemo(
    () => computeRtVulnerability(reports, jumantikLogs),
    [reports, jumantikLogs]
  );

  // Per-RT comprehensive stats across all 10 RTs (RT 001 – RT 010)
  const tenRtSummary = useMemo(() => {
    const categories = Object.keys(CATEGORY_CATALOG) as ReportCategory[];

    return RT_UNITS.map((rt) => {
      const rtReports = reports.filter((r) => r.rt === rt);
      const rtLogs = jumantikLogs.filter((l) => l.rt === rt);
      const hotspot = hotspots.find((h) => h.rt === rt);

      const active = rtReports.filter(
        (r) => r.status !== 'selesai' && r.status !== 'ditolak'
      ).length;
      const completed = rtReports.filter((r) => r.status === 'selesai').length;
      const urgent = rtReports.filter(
        (r) => r.urgency === 'tinggi' || r.urgency === 'darurat'
      ).length;

      const inspected = rtLogs.reduce((acc, l) => acc + l.housesInspected, 0);
      const positive = rtLogs.reduce((acc, l) => acc + l.housesWithLarvae, 0);
      const abjPercent =
        inspected > 0
          ? Number((((inspected - positive) / inspected) * 100).toFixed(1))
          : null;

      const byCat: Record<ReportCategory, number> = {
        kesehatan_jentik: 0,
        drainase_banjir: 0,
        infrastruktur: 0,
        kebersihan: 0,
        keamanan: 0,
        fasilitas_umum: 0,
      };
      for (const c of categories) {
        byCat[c] = rtReports.filter((r) => r.category === c).length;
      }

      return {
        rt,
        total: rtReports.length,
        active,
        completed,
        urgent,
        inspected,
        positive,
        abjPercent,
        riskLevel: hotspot?.riskLevel || 'terkendali',
        hotspot,
        byCat,
      };
    });
  }, [reports, jumantikLogs, hotspots]);

  const activeRtSummary = useMemo(
    () => tenRtSummary.find((s) => s.rt === selectedRt) || tenRtSummary[0],
    [tenRtSummary, selectedRt]
  );

  const selectedRtReports = useMemo(() => {
    return reports.filter((r) => {
      if (r.rt !== selectedRt) return false;
      if (statusScope === 'ACTIVE' && (r.status === 'selesai' || r.status === 'ditolak')) {
        return false;
      }
      if (statusScope === 'DONE' && r.status !== 'selesai') {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${r.title} ${r.description} ${r.address} ${r.authorName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [reports, selectedRt, statusScope, searchQuery]);

  const selectedRtMapCenter = useMemo(() => {
    if (selectedRtReports.length > 0) {
      return {
        lat: selectedRtReports[0].latitude,
        lng: selectedRtReports[0].longitude,
      };
    }
    if (activeRtSummary.hotspot) {
      return {
        lat: activeRtSummary.hotspot.lat,
        lng: activeRtSummary.hotspot.lng,
      };
    }
    return DEFAULT_RW013_CENTER;
  }, [selectedRtReports, activeRtSummary]);

  const downloadCsvRecap = (mode: 'selected' | 'all10') => {
    let csvContent = '';
    let filename = '';

    if (mode === 'all10') {
      const headers = [
        'Wilayah RT',
        'Total Laporan',
        'Aktif',
        'Selesai',
        'Tinggi/Darurat',
        'Kesehatan & Jentik',
        'Drainase & Banjir',
        'Infrastruktur',
        'Kebersihan',
        'Keamanan',
        'Fasilitas/PJU',
        'Rumah Diperiksa (ABJ)',
        'Positif Jentik',
        'ABJ (%)',
        'Status Wilayah',
      ];
      const rows = tenRtSummary.map((s) => [
        s.rt,
        s.total,
        s.active,
        s.completed,
        s.urgent,
        s.byCat.kesehatan_jentik,
        s.byCat.drainase_banjir,
        s.byCat.infrastruktur,
        s.byCat.kebersihan,
        s.byCat.keamanan,
        s.byCat.fasilitas_umum,
        s.inspected,
        s.positive,
        s.abjPercent === null ? '-' : `${s.abjPercent}%`,
        s.riskLevel.toUpperCase(),
      ]);
      csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      filename = `rekap-10-rt-rw013-${new Date().toISOString().slice(0, 10)}.csv`;
    } else {
      const rtItems = reports.filter((r) => r.rt === selectedRt);
      const headers = [
        'ID Laporan',
        'RT',
        'Judul',
        'Kategori',
        'Urgensi',
        'Status',
        'Pelapor',
        'Alamat',
        'Latitude',
        'Longitude',
        'Instansi Tujuan',
        'Waktu Lapor',
      ];
      const escapeCsv = (val: string | number) =>
        `"${String(val).replace(/"/g, '""')}"`;

      const rows = rtItems.map((r) => [
        escapeCsv(r.id),
        escapeCsv(r.rt),
        escapeCsv(r.title),
        escapeCsv(CATEGORY_CATALOG[r.category]?.shortLabel || r.category),
        escapeCsv(URGENCY_LABELS[r.urgency]),
        escapeCsv(STATUS_LABELS[r.status]),
        escapeCsv(r.authorName),
        escapeCsv(r.address),
        r.latitude,
        r.longitude,
        escapeCsv(r.assignedAgency || '-'),
        escapeCsv(formatTimestamp(r.createdAt)),
      ]);
      csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      filename = `laporan-${selectedRt.toLowerCase().replace(/\s+/g, '')}-rw013.csv`;
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const completionPct =
    activeRtSummary.total > 0
      ? Math.round((activeRtSummary.completed / activeRtSummary.total) * 100)
      : 0;

  return (
    <div className="space-y-8">
      {/* Header & Primary Actions */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Mode Laporan Per RT (10 Wilayah RT)
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Pemantauan terfokus untuk masing-masing RT (RT 001 s/d RT 010) di lingkungan RW 013 beserta matriks perbandingan antar-RT.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => downloadCsvRecap('all10')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Unduh Matriks 10 RT (CSV)</span>
          </button>

          <button
            type="button"
            onClick={() => onCreateReportForRt(selectedRt)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Buat Laporan {selectedRt}</span>
          </button>
        </div>
      </div>

      {/* 10-RT Interactive Selector Grid (2x5 Mobile, 5x2 Desktop) */}
      <section aria-label="Pemilih 10 Wilayah RT" className="space-y-3">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span className="font-semibold text-slate-700">
            Pilih Wilayah RT (RT 001 – RT 010)
          </span>
          <span className="font-mono">Total 10 RT · RW 013</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {tenRtSummary.map((item) => {
            const isSelected = item.rt === selectedRt;
            return (
              <button
                key={item.rt}
                type="button"
                onClick={() => setSelectedRt(item.rt)}
                className={`text-left p-3.5 rounded-xl border transition-colors cursor-pointer space-y-2 ${
                  isSelected
                    ? 'bg-slate-900 border-slate-900 text-white'
                    : 'bg-white border-slate-200 text-slate-900 hover:border-slate-400'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold font-mono tracking-tight">
                    {item.rt}
                  </span>
                  <span
                    className={`text-[11px] font-medium ${
                      isSelected
                        ? 'text-slate-300'
                        : item.riskLevel === 'tinggi'
                        ? 'text-red-700 font-semibold'
                        : item.riskLevel === 'waspada'
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                    }`}
                  >
                    {item.riskLevel === 'tinggi'
                      ? 'Rawan'
                      : item.riskLevel === 'waspada'
                      ? 'Waspada'
                      : 'Terkendali'}
                  </span>
                </div>

                <div
                  className={`text-xs font-mono tabular-nums ${
                    isSelected ? 'text-slate-200' : 'text-slate-600'
                  }`}
                >
                  <span>{item.total} laporan</span>
                  <span aria-hidden="true"> · </span>
                  <span>{item.active} aktif</span>
                </div>

                <div
                  className={`text-[11px] font-mono tabular-nums pt-1 border-t ${
                    isSelected
                      ? 'border-slate-800 text-slate-300'
                      : 'border-slate-100 text-slate-500'
                  }`}
                >
                  ABJ: {item.abjPercent === null ? '–' : `${item.abjPercent}%`}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Selected RT KPI Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <p className="text-xs text-slate-500">Total Laporan {selectedRt}</p>
          <p className="text-3xl font-bold font-mono tabular-nums text-slate-900">
            {activeRtSummary.total}
          </p>
          <p className="text-xs text-slate-500 font-mono">
            {activeRtSummary.urgent} urgensi tinggi/darurat
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <p className="text-xs text-slate-500">Laporan Aktif {selectedRt}</p>
          <p className="text-3xl font-bold font-mono tabular-nums text-amber-700">
            {activeRtSummary.active}
          </p>
          <p className="text-xs text-slate-500">Menunggu / sedang diproses</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <p className="text-xs text-slate-500">Selesai Ditangani</p>
          <p className="text-3xl font-bold font-mono tabular-nums text-emerald-700">
            {activeRtSummary.completed}
          </p>
          <p className="text-xs text-slate-500 font-mono">
            Tingkat penyelesaian {completionPct}%
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
          <p className="text-xs text-slate-500">Capaian ABJ {selectedRt}</p>
          <p
            className={`text-3xl font-bold font-mono tabular-nums ${
              activeRtSummary.abjPercent === null
                ? 'text-slate-900'
                : activeRtSummary.abjPercent >= 95
                ? 'text-emerald-700'
                : 'text-red-700'
            }`}
          >
            {activeRtSummary.abjPercent === null ? '–' : `${activeRtSummary.abjPercent}%`}
          </p>
          <p className="text-xs text-slate-500 font-mono">
            {activeRtSummary.inspected} rumah · {activeRtSummary.positive} jentik
          </p>
        </div>
      </section>

      {/* Focused RT Workspace: Map + Category Breakdown (Left) & Filtered Reports Feed (Right) */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Peta Sebaran Kejadian {selectedRt}
                </h2>
                <p className="text-xs text-slate-500">
                  Titik koordinat laporan warga khusus wilayah {selectedRt}
                </p>
              </div>
              <button
                type="button"
                onClick={() => downloadCsvRecap('selected')}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900 underline underline-offset-2 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV {selectedRt}</span>
              </button>
            </div>

            <InteractiveMap
              center={selectedRtMapCenter}
              zoom={16}
              heightClass="h-72"
              mode="explorer"
              reports={selectedRtReports}
              hotspots={activeRtSummary.hotspot ? [activeRtSummary.hotspot] : []}
              showHotspots={true}
              onSelectReport={onSelectReport}
            />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Komposisi Kategori Laporan {selectedRt}
            </h3>
            <div className="divide-y divide-slate-100 text-xs">
              {Object.values(CATEGORY_CATALOG).map((cat) => {
                const count = activeRtSummary.byCat[cat.id] || 0;
                return (
                  <div
                    key={cat.id}
                    className="py-2.5 flex items-center justify-between gap-3"
                  >
                    <span className="text-slate-700">{cat.label}</span>
                    <span className="font-mono tabular-nums font-semibold text-slate-900">
                      {count} laporan
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Reports List for Selected RT */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-slate-200 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Daftar Laporan Warga {selectedRt} ({selectedRtReports.length})
                </h2>
                <p className="text-xs text-slate-500">
                  Klik laporan untuk melihat foto penuh, koordinat GPS, dan tanggapan instansi
                </p>
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
                {(
                  [
                    { id: 'ALL', label: 'Semua' },
                    { id: 'ACTIVE', label: 'Aktif' },
                    { id: 'DONE', label: 'Selesai' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStatusScope(tab.id)}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      statusScope === tab.id
                        ? 'bg-white text-slate-900 shadow-xs font-semibold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Cari judul kejadian, alamat, atau nama pelapor di ${selectedRt}...`}
                className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>

          {selectedRtReports.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm font-semibold text-slate-900">
                Belum ada laporan tercatat untuk {selectedRt}
              </p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Kondisi wilayah {selectedRt} saat ini belum memiliki laporan pada filter yang dipilih. Warga atau pengurus RT dapat langsung mengirim laporan baru.
              </p>
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => onCreateReportForRt(selectedRt)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Kirim Laporan untuk {selectedRt}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {selectedRtReports.map((rep) => {
                const catMeta = CATEGORY_CATALOG[rep.category];
                return (
                  <article
                    key={rep.id}
                    onClick={() => onSelectReport(rep)}
                    className="p-4 sm:p-5 hover:bg-slate-50 transition-colors cursor-pointer flex flex-col sm:flex-row gap-4"
                  >
                    {rep.photoDataUrl ? (
                      <img
                        src={rep.photoDataUrl}
                        alt={rep.title}
                        referrerPolicy="no-referrer"
                        className="w-full sm:w-28 h-36 sm:h-24 object-cover rounded-lg border border-slate-200 shrink-0"
                      />
                    ) : null}

                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        <span className="font-medium text-slate-800">
                          {catMeta?.shortLabel || rep.category}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            rep.urgency === 'darurat'
                              ? 'text-red-700 font-semibold'
                              : rep.urgency === 'tinggi'
                              ? 'text-amber-700 font-semibold'
                              : 'text-slate-600'
                          }
                        >
                          Urgensi {URGENCY_LABELS[rep.urgency]}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>Oleh {rep.authorName}</span>
                      </div>

                      <h3 className="text-sm font-semibold text-slate-900 leading-snug">
                        {rep.title}
                      </h3>
                      <p className="text-xs text-slate-600 line-clamp-2">{rep.description}</p>

                      <div className="pt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="inline-flex items-center gap-1 text-slate-500 truncate max-w-xs">
                          <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                          <span className="truncate">{rep.address}</span>
                        </span>

                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`inline-flex items-center gap-1 font-semibold ${
                              rep.status === 'selesai'
                                ? 'text-emerald-700'
                                : rep.status === 'menunggu'
                                ? 'text-amber-700'
                                : rep.status === 'ditolak'
                                ? 'text-slate-400'
                                : 'text-sky-700'
                            }`}
                          >
                            {rep.status === 'selesai' && (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            )}
                            {STATUS_LABELS[rep.status]}
                          </span>
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                          <span className="font-mono text-[11px] text-slate-400">
                            {formatTimestamp(rep.createdAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Comparative 10-RT Cross-Sector Matrix */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Tabel Perbandingan Lintas 10 RT (RT 001 – RT 010)
            </h2>
            <p className="text-xs text-slate-500">
              Rekapitulasi lengkap seluruh kategori laporan warga dan surveilans jentik di 10 RT lingkungan RW 013
            </p>
          </div>
          <span className="text-xs text-slate-500">Klik baris RT untuk beralih fokus</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="py-3 px-4 font-semibold">RT</th>
                <th className="py-3 px-3 font-semibold text-right">Kesehatan</th>
                <th className="py-3 px-3 font-semibold text-right">Drainase</th>
                <th className="py-3 px-3 font-semibold text-right">Infrastruktur</th>
                <th className="py-3 px-3 font-semibold text-right">Kebersihan</th>
                <th className="py-3 px-3 font-semibold text-right">Keamanan</th>
                <th className="py-3 px-3 font-semibold text-right">PJU/Fasum</th>
                <th className="py-3 px-3 font-semibold text-right">Total</th>
                <th className="py-3 px-3 font-semibold text-right">Aktif</th>
                <th className="py-3 px-3 font-semibold text-right">Selesai</th>
                <th className="py-3 px-4 font-semibold text-right">ABJ (%)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tenRtSummary.map((row) => {
                const isSelected = row.rt === selectedRt;
                return (
                  <tr
                    key={row.rt}
                    onClick={() => setSelectedRt(row.rt)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-slate-100 font-medium' : 'hover:bg-slate-50/80'
                    }`}
                  >
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {row.rt}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                      {row.byCat.kesehatan_jentik}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                      {row.byCat.drainase_banjir}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                      {row.byCat.infrastruktur}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                      {row.byCat.kebersihan}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                      {row.byCat.keamanan}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                      {row.byCat.fasilitas_umum}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {row.total}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-amber-700">
                      {row.active}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700">
                      {row.completed}
                    </td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono tabular-nums font-semibold ${
                        row.abjPercent === null
                          ? 'text-slate-400'
                          : row.abjPercent >= 95
                          ? 'text-emerald-700'
                          : 'text-red-700'
                      }`}
                    >
                      {row.abjPercent === null ? '–' : `${row.abjPercent}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-900">
                <td className="py-3 px-4 font-mono">TOTAL 10 RT</td>
                <td className="py-3 px-3 text-right font-mono tabular-nums">
                  {tenRtSummary.reduce((s, r) => s + r.byCat.kesehatan_jentik, 0)}
                </td>
                <td className="py-3 px-3 text-right font-mono tabular-nums">
                  {tenRtSummary.reduce((s, r) => s + r.byCat.drainase_banjir, 0)}
                </td>
                <td className="py-3 px-3 text-right font-mono tabular-nums">
                  {tenRtSummary.reduce((s, r) => s + r.byCat.infrastruktur, 0)}
                </td>
                <td className="py-3 px-3 text-right font-mono tabular-nums">
                  {tenRtSummary.reduce((s, r) => s + r.byCat.kebersihan, 0)}
                </td>
                <td className="py-3 px-3 text-right font-mono tabular-nums">
                  {tenRtSummary.reduce((s, r) => s + r.byCat.keamanan, 0)}
                </td>
                <td className="py-3 px-3 text-right font-mono tabular-nums">
                  {tenRtSummary.reduce((s, r) => s + r.byCat.fasilitas_umum, 0)}
                </td>
                <td className="py-3 px-3 text-right font-mono tabular-nums">
                  {tenRtSummary.reduce((s, r) => s + r.total, 0)}
                </td>
                <td className="py-3 px-3 text-right font-mono tabular-nums text-amber-700">
                  {tenRtSummary.reduce((s, r) => s + r.active, 0)}
                </td>
                <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-700">
                  {tenRtSummary.reduce((s, r) => s + r.completed, 0)}
                </td>
                <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-500">
                  RW 013
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
};
