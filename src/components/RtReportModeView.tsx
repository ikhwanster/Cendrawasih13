import React, { useMemo, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Download,
  Home,
  Image as ImageIcon,
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
  const [catalogFilter, setCatalogFilter] = useState<'ALL' | 'RAWAN' | 'AMAN' | 'MATRIX'>('ALL');
  const [statusScope, setStatusScope] = useState<'ALL' | 'ACTIVE' | 'DONE'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const hotspots = useMemo(
    () => computeRtVulnerability(reports, jumantikLogs),
    [reports, jumantikLogs]
  );

  // Per-RT comprehensive stats across all 10 RTs (RT 001 – RT 010)
  const tenRtSummary = useMemo(() => {
    const categories = Object.keys(CATEGORY_CATALOG) as ReportCategory[];

    return RT_UNITS.map((rt, idx) => {
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
        shortNum: String(idx + 1).padStart(2, '0'),
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

  const visibleGridRts = useMemo(() => {
    if (catalogFilter === 'RAWAN') {
      return tenRtSummary.filter((s) => s.riskLevel !== 'terkendali' || s.active > 0);
    }
    if (catalogFilter === 'AMAN') {
      return tenRtSummary.filter((s) => s.riskLevel === 'terkendali' && s.active === 0);
    }
    return tenRtSummary;
  }, [tenRtSummary, catalogFilter]);

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
    <div className="space-y-5">
      {/* Top Search & Catalog Filter Tabs (Reference Screen 10 Motif) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold text-[#263015] tracking-tight">
              Katalog 10 Wilayah RT
            </h1>
            <p className="text-xs text-[#5b6649]">
              Pilih kartu kotak RT (RT 001 – RT 010) untuk memantau laporan warga
            </p>
          </div>
          <button
            type="button"
            onClick={() => downloadCsvRecap('all10')}
            className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#586826] bg-[#e6f2d3] border border-[#cbe0b0] rounded-full hover:bg-[#dcecc3] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV 10 RT</span>
          </button>
        </div>

        {/* Horizontal Filter Bar like Reference Screen 10 */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {(
            [
              { id: 'ALL', label: 'Semua 10 RT' },
              { id: 'RAWAN', label: 'Ada Aktif / Waspada' },
              { id: 'AMAN', label: 'Terkendali' },
              { id: 'MATRIX', label: 'Tabel Matriks' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setCatalogFilter(f.id)}
              className={`min-h-[38px] px-3.5 py-1.5 text-xs font-semibold rounded-full transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                catalogFilter === f.id
                  ? 'bg-[#a5cf4c] text-[#263015]'
                  : 'bg-white border border-[#cbe0b0] text-[#5b6649] hover:text-[#263015]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* 3-Column Square Olive Grid Catalog (Reference Screen 10) */}
      {catalogFilter !== 'MATRIX' && (
        <section aria-label="Grid Katalog 10 RT" className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
          {visibleGridRts.map((item) => {
            const isSelected = item.rt === selectedRt;
            return (
              <button
                key={item.rt}
                type="button"
                onClick={() => setSelectedRt(item.rt)}
                className={`text-left p-2 rounded-2xl border transition-all active:scale-[0.98] cursor-pointer flex flex-col space-y-2 ${
                  isSelected
                    ? 'bg-[#dcecc3] border-[#586826] ring-2 ring-[#586826]/30'
                    : 'bg-white border-[#cbe0b0] hover:bg-[#e6f2d3]/50'
                }`}
              >
                {/* Signature Square Olive Block */}
                <div
                  className={`w-full aspect-square rounded-xl flex flex-col items-center justify-center relative ${
                    isSelected
                      ? 'bg-[#586826] text-[#a5cf4c]'
                      : 'bg-[#586826] text-[#dcecc3]'
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg border-[1.8px] border-current flex items-center justify-center mb-1">
                    <Home className="w-4 h-4" />
                  </div>
                  <span className="font-mono text-xs font-bold tracking-tight">
                    RT {item.shortNum}
                  </span>
                </div>

                {/* Stacked Clean Metadata Lines underneath the Square */}
                <div className="px-0.5 space-y-0.5">
                  <p className="text-xs font-bold text-[#263015] font-mono truncate">
                    {item.rt}
                  </p>
                  <p className="text-[11px] font-mono tabular-nums text-[#5b6649] truncate">
                    {item.total} lap · {item.active} aktif
                  </p>
                  <div className="pt-1 flex items-center justify-between gap-1 text-[10px] font-mono">
                    <span className="text-[#586826] font-semibold">
                      ABJ {item.abjPercent === null ? '–' : `${item.abjPercent}%`}
                    </span>
                    <span
                      className={
                        item.riskLevel === 'tinggi'
                          ? 'text-red-700 font-bold'
                          : item.riskLevel === 'waspada'
                          ? 'text-amber-700 font-semibold'
                          : 'text-[#586826]'
                      }
                    >
                      {item.riskLevel === 'tinggi'
                        ? 'Rawan'
                        : item.riskLevel === 'waspada'
                        ? 'Waspada'
                        : 'Aman'}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </section>
      )}

      {/* Focused Selected RT Workspace Card (Reference Screen 6 & 8 Fusion) */}
      <section className="bg-[#dcecc3] border border-[#cbe0b0] rounded-3xl p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-medium text-[#5b6649]">
              Fokus Wilayah Terpilih · RW 013
            </p>
            <h2 className="text-lg font-bold text-[#263015] font-mono">{selectedRt}</h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => downloadCsvRecap('selected')}
              className="min-h-[40px] inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-[#586826] bg-[#f7f9f4] border border-[#cbe0b0] rounded-full hover:bg-white cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
            <button
              type="button"
              onClick={() => onCreateReportForRt(selectedRt)}
              className="min-h-[40px] inline-flex items-center gap-1 px-3.5 py-1.5 text-xs font-semibold text-[#f7f9f4] bg-[#586826] rounded-full hover:bg-[#48561e] active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Lapor {selectedRt}</span>
            </button>
          </div>
        </div>

        {/* 2x2 Compact Olive & White Metric Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="bg-[#f7f9f4] border border-[#cbe0b0] rounded-2xl p-3 space-y-0.5">
            <p className="text-[11px] text-[#5b6649]">Total Laporan</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-[#263015]">
              {activeRtSummary.total}
            </p>
            <p className="text-[10px] font-mono text-[#5b6649]">
              {activeRtSummary.urgent} darurat/tinggi
            </p>
          </div>

          <div className="bg-[#f7f9f4] border border-[#cbe0b0] rounded-2xl p-3 space-y-0.5">
            <p className="text-[11px] text-[#5b6649]">Sedang Aktif</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-amber-800">
              {activeRtSummary.active}
            </p>
            <p className="text-[10px] text-[#5b6649]">Menunggu / proses</p>
          </div>

          <div className="bg-[#f7f9f4] border border-[#cbe0b0] rounded-2xl p-3 space-y-0.5">
            <p className="text-[11px] text-[#5b6649]">Selesai</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-[#586826]">
              {activeRtSummary.completed}
            </p>
            <p className="text-[10px] font-mono text-[#5b6649]">Tuntas {completionPct}%</p>
          </div>

          <div className="bg-[#586826] text-[#f7f9f4] rounded-2xl p-3 space-y-0.5">
            <p className="text-[11px] text-[#dcecc3]">ABJ {selectedRt}</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-[#a5cf4c]">
              {activeRtSummary.abjPercent === null ? '–' : `${activeRtSummary.abjPercent}%`}
            </p>
            <p className="text-[10px] font-mono text-[#dcecc3]/90">
              {activeRtSummary.inspected} rumah cek
            </p>
          </div>
        </div>

        {/* Interactive Geographic Map for Selected RT */}
        <div className="bg-[#f7f9f4] border border-[#cbe0b0] rounded-2xl p-3 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[#263015]">
              Peta Titik Laporan {selectedRt}
            </span>
            <span className="font-mono text-[11px] text-[#5b6649]">
              {selectedRtReports.length} pin tampil
            </span>
          </div>
          <InteractiveMap
            center={selectedRtMapCenter}
            zoom={16}
            heightClass="h-52"
            mode="explorer"
            reports={selectedRtReports}
            hotspots={activeRtSummary.hotspot ? [activeRtSummary.hotspot] : []}
            showHotspots={true}
            onSelectReport={onSelectReport}
          />
        </div>

        {/* Category Progress Composition */}
        <div className="bg-[#f7f9f4] border border-[#cbe0b0] rounded-2xl p-3.5 space-y-2.5">
          <h3 className="text-xs font-bold text-[#263015]">
            Komposisi Sektor Laporan {selectedRt}
          </h3>
          <div className="space-y-2 text-xs">
            {Object.values(CATEGORY_CATALOG).map((cat) => {
              const count = activeRtSummary.byCat[cat.id] || 0;
              const pct =
                activeRtSummary.total > 0
                  ? Math.round((count / activeRtSummary.total) * 100)
                  : 0;
              return (
                <div key={cat.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#263015] truncate">{cat.shortLabel}</span>
                    <span className="font-mono tabular-nums text-[11px] text-[#5b6649] shrink-0">
                      {count} laporan
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-[#e6f2d3] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#586826] rounded-full"
                      style={{ width: `${count > 0 ? Math.max(8, pct) : 0}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Selected RT Horizontal Report Cards (Reference Screen 5 & 6 Motif) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[#263015]">
            Daftar Laporan {selectedRt} ({selectedRtReports.length})
          </h3>
          <div className="flex items-center gap-1 p-1 bg-[#e6f2d3] rounded-full">
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
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-full transition-colors whitespace-nowrap cursor-pointer ${
                  statusScope === tab.id
                    ? 'bg-[#586826] text-[#f7f9f4]'
                    : 'text-[#5b6649] hover:text-[#263015]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#5b6649] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Cari kejadian atau alamat di ${selectedRt}...`}
            className="w-full min-h-[42px] pl-9 pr-3.5 py-2 text-xs bg-white border border-[#cbe0b0] rounded-full text-[#263015] placeholder:text-[#5b6649]/70 focus:outline-none focus:ring-2 focus:ring-[#586826]"
          />
        </div>

        {selectedRtReports.length === 0 ? (
          <div className="bg-white border border-[#cbe0b0] rounded-3xl p-7 text-center space-y-3">
            <p className="text-sm font-semibold text-[#263015]">
              Belum ada laporan warga di {selectedRt}
            </p>
            <p className="text-xs text-[#5b6649]">
              Kirimkan foto kejadian beserta titik lokasi GPS untuk wilayah {selectedRt}.
            </p>
            <button
              type="button"
              onClick={() => onCreateReportForRt(selectedRt)}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold text-[#f7f9f4] bg-[#586826] rounded-full hover:bg-[#48561e] cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Kirim Laporan {selectedRt}</span>
            </button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {selectedRtReports.map((rep) => {
              const catMeta = CATEGORY_CATALOG[rep.category];
              return (
                <article
                  key={rep.id}
                  onClick={() => onSelectReport(rep)}
                  className="bg-[#e6f2d3] hover:bg-[#dcecc3] border border-[#cbe0b0] rounded-2xl p-3 transition-colors cursor-pointer flex items-center gap-3"
                >
                  {/* Square Deep Olive Thumbnail on Left (Reference Screen 5/6) */}
                  <div className="w-16 h-16 rounded-xl bg-[#586826] text-[#dcecc3] overflow-hidden shrink-0 flex items-center justify-center border border-[#48561e]">
                    {rep.photoDataUrl ? (
                      <img
                        src={rep.photoDataUrl}
                        alt={rep.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="w-6 h-6" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-[#5b6649] truncate">
                      <span className="font-semibold text-[#586826]">
                        {catMeta?.shortLabel || rep.category}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{URGENCY_LABELS[rep.urgency]}</span>
                    </div>

                    <h4 className="text-xs font-bold text-[#263015] truncate">{rep.title}</h4>

                    <div className="flex items-center justify-between gap-2 text-[11px] text-[#5b6649]">
                      <span className="inline-flex items-center gap-1 truncate">
                        <MapPin className="w-3 h-3 shrink-0 text-[#586826]" />
                        <span className="truncate">{rep.address}</span>
                      </span>
                      <span className="inline-flex items-center gap-1 font-semibold text-[#263015] shrink-0">
                        {rep.status === 'selesai' && (
                          <CheckCircle2 className="w-3 h-3 text-[#586826]" />
                        )}
                        {STATUS_LABELS[rep.status]}
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Comparative 10-RT Cross-Sector Matrix */}
      <section className="bg-white border border-[#cbe0b0] rounded-3xl overflow-hidden">
        <div className="px-4 py-3.5 border-b border-[#cbe0b0] bg-[#e6f2d3]/60 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-bold text-[#263015]">
              Matriks Perbandingan 10 RT (RT 001 – RT 010)
            </h2>
            <p className="text-[11px] text-[#5b6649]">
              Geser ke samping untuk rincian kategori tiap RT
            </p>
          </div>
          <span className="text-[11px] font-mono text-[#586826] shrink-0">RW 013</span>
        </div>

        <div className="overflow-x-auto phone-scroll">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#cbe0b0] bg-[#f7f9f4] text-[#5b6649]">
                <th className="py-2.5 px-3 font-semibold">RT</th>
                <th className="py-2.5 px-2.5 font-semibold text-right">Total</th>
                <th className="py-2.5 px-2.5 font-semibold text-right">Aktif</th>
                <th className="py-2.5 px-2.5 font-semibold text-right">Selesai</th>
                <th className="py-2.5 px-2.5 font-semibold text-right">ABJ</th>
                <th className="py-2.5 px-2.5 font-semibold text-right">Jentik</th>
                <th className="py-2.5 px-2.5 font-semibold text-right">Banjir</th>
                <th className="py-2.5 px-2.5 font-semibold text-right">Jalan</th>
                <th className="py-2.5 px-2.5 font-semibold text-right">Sampah</th>
                <th className="py-2.5 px-2.5 font-semibold text-right">Aman</th>
                <th className="py-2.5 px-3 font-semibold text-right">PJU</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e6f2d3]">
              {tenRtSummary.map((row) => {
                const isSelected = row.rt === selectedRt;
                return (
                  <tr
                    key={row.rt}
                    onClick={() => setSelectedRt(row.rt)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-[#dcecc3] font-semibold' : 'hover:bg-[#f7f9f4]'
                    }`}
                  >
                    <td className="py-2.5 px-3 font-mono font-bold text-[#263015] whitespace-nowrap">
                      {row.rt}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono tabular-nums font-semibold text-[#263015]">
                      {row.total}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-amber-800">
                      {row.active}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-[#586826]">
                      {row.completed}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono tabular-nums font-semibold text-[#263015]">
                      {row.abjPercent === null ? '–' : `${row.abjPercent}%`}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-[#5b6649]">
                      {row.byCat.kesehatan_jentik}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-[#5b6649]">
                      {row.byCat.drainase_banjir}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-[#5b6649]">
                      {row.byCat.infrastruktur}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-[#5b6649]">
                      {row.byCat.kebersihan}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-[#5b6649]">
                      {row.byCat.keamanan}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#5b6649]">
                      {row.byCat.fasilitas_umum}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[#cbe0b0] bg-[#e6f2d3] font-bold text-[#263015]">
                <td className="py-2.5 px-3 font-mono">TOTAL</td>
                <td className="py-2.5 px-2.5 text-right font-mono tabular-nums">
                  {tenRtSummary.reduce((s, r) => s + r.total, 0)}
                </td>
                <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-amber-800">
                  {tenRtSummary.reduce((s, r) => s + r.active, 0)}
                </td>
                <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-[#586826]">
                  {tenRtSummary.reduce((s, r) => s + r.completed, 0)}
                </td>
                <td className="py-2.5 px-2.5 text-right font-mono text-[11px] text-[#586826]">
                  RW013
                </td>
                <td className="py-2.5 px-2.5 text-right font-mono tabular-nums">
                  {tenRtSummary.reduce((s, r) => s + r.byCat.kesehatan_jentik, 0)}
                </td>
                <td className="py-2.5 px-2.5 text-right font-mono tabular-nums">
                  {tenRtSummary.reduce((s, r) => s + r.byCat.drainase_banjir, 0)}
                </td>
                <td className="py-2.5 px-2.5 text-right font-mono tabular-nums">
                  {tenRtSummary.reduce((s, r) => s + r.byCat.infrastruktur, 0)}
                </td>
                <td className="py-2.5 px-2.5 text-right font-mono tabular-nums">
                  {tenRtSummary.reduce((s, r) => s + r.byCat.kebersihan, 0)}
                </td>
                <td className="py-2.5 px-2.5 text-right font-mono tabular-nums">
                  {tenRtSummary.reduce((s, r) => s + r.byCat.keamanan, 0)}
                </td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                  {tenRtSummary.reduce((s, r) => s + r.byCat.fasilitas_umum, 0)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
};
