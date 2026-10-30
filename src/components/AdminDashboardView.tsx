import React, { useMemo, useRef, useState } from 'react';
import {
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  BellRing,
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  AGENCY_LABELS,
  CATEGORY_CATALOG,
  RT_UNITS,
  STATUS_LABELS,
  URGENCY_LABELS,
  VALIDATION_LIMITS,
  type AgencyCode,
  type CitizenReport,
  type ReportCategory,
  type ReportStatus,
  type ReportUrgency,
  type UserPublicProfile,
} from '../types';
import { formatTimestamp, generateSafeId } from '../utils/geoAndImage';

interface AdminDashboardViewProps {
  reports: CitizenReport[];
  adminProfile: UserPublicProfile;
  isBootstrappedAdmin: boolean;
}

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({
  reports,
  adminProfile,
  isBootstrappedAdmin,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ReportStatus>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | ReportCategory>('ALL');
  const [rtFilter, setRtFilter] = useState<string>('ALL');

  const [selectedReportId, setSelectedReportId] = useState<string | null>(
    reports[0]?.id || null
  );
  const inspectorRef = useRef<HTMLDivElement | null>(null);

  const selectedReport = useMemo(
    () => reports.find((r) => r.id === selectedReportId) || null,
    [reports, selectedReportId]
  );

  // Triage Form State synced when selectedReport changes
  const [nextStatus, setNextStatus] = useState<ReportStatus>('diverifikasi');
  const [nextUrgency, setNextUrgency] = useState<ReportUrgency>('sedang');
  const [nextCategory, setNextCategory] = useState<ReportCategory>('kesehatan_jentik');
  const [agencyCode, setAgencyCode] = useState<AgencyCode>('PUSKESMAS_RW013');
  const [adminNote, setAdminNote] = useState('');
  const [sendAgencyApiDispatch, setSendAgencyApiDispatch] = useState(true);

  const [savingTriage, setSavingTriage] = useState(false);
  const [actionFeedback, setActionFeedback] = useState('');
  const [actionError, setActionError] = useState('');

  // Manage Additional Officer UID (for Bootstrapped Admin)
  const [newOfficerUid, setNewOfficerUid] = useState('');
  const [grantFeedback, setGrantFeedback] = useState('');

  const selectReportForTriage = (rep: CitizenReport) => {
    setSelectedReportId(rep.id);
    setNextStatus(rep.status === 'menunggu' ? 'diverifikasi' : rep.status);
    setNextUrgency(rep.urgency);
    setNextCategory(rep.category);
    const defaultAgency = CATEGORY_CATALOG[rep.category]?.defaultAgency || 'PUSKESMAS_RW013';
    const matchedAgency = (Object.keys(AGENCY_LABELS) as AgencyCode[]).find(
      (k) => k === rep.assignedAgency || AGENCY_LABELS[k] === rep.assignedAgency
    );
    setAgencyCode(matchedAgency || defaultAgency);
    setAdminNote(rep.adminNote || '');
    setActionFeedback('');
    setActionError('');
    window.setTimeout(() => {
      inspectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  };

  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (categoryFilter !== 'ALL' && r.category !== categoryFilter) return false;
      if (rtFilter !== 'ALL' && r.rt !== rtFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${r.title} ${r.description} ${r.address} ${r.authorName} ${r.rt}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [reports, statusFilter, categoryFilter, rtFilter, searchQuery]);

  const metrics = useMemo(() => {
    return {
      total: reports.length,
      waiting: reports.filter((r) => r.status === 'menunggu').length,
      inProgress: reports.filter(
        (r) => r.status === 'diverifikasi' || r.status === 'diproses'
      ).length,
      completed: reports.filter((r) => r.status === 'selesai').length,
    };
  }, [reports]);

  const handleSaveTriage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReport) return;

    setSavingTriage(true);
    setActionFeedback('');
    setActionError('');

    const cleanNote = adminNote.trim().slice(0, VALIDATION_LIMITS.ADMIN_NOTE_MAX);
    const agencyLabel = AGENCY_LABELS[agencyCode];
    const reportPath = `reports/${selectedReport.id}`;

    try {
      // 1. Update Citizen Report Triage Fields (strictly matching allowed keys in firestore.rules)
      await updateDoc(doc(db, 'reports', selectedReport.id), {
        status: nextStatus,
        urgency: nextUrgency,
        category: nextCategory,
        assignedAgency: agencyLabel.slice(0, 120),
        adminNote: cleanNote,
        updatedAt: serverTimestamp(),
      });

      // 2. Deliver Real-Time Push Notification to Report Author
      const notifId = generateSafeId('ntf');
      const notifMsg = cleanNote
        ? `Status diperbarui menjadi "${STATUS_LABELS[nextStatus]}" (${agencyLabel}): ${cleanNote}`
        : `Laporan Anda kini berstatus "${STATUS_LABELS[nextStatus]}" dan diteruskan ke ${agencyLabel}.`;

      try {
        await setDoc(doc(db, 'notifications', notifId), {
          recipientId: selectedReport.authorId,
          senderId: adminProfile.uid,
          reportId: selectedReport.id,
          reportTitle: selectedReport.title.slice(0, VALIDATION_LIMITS.TITLE_MAX),
          newStatus: nextStatus,
          message: notifMsg.slice(0, 500),
          read: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (notifErr) {
        handleFirestoreError(notifErr, OperationType.CREATE, `notifications/${notifId}`);
      }

      // 3. Optionally trigger Municipal Agency API Dispatch
      let dispatchNote = '';
      if (sendAgencyApiDispatch && nextStatus !== 'ditolak') {
        const priorityMap: Record<ReportUrgency, 'normal' | 'tinggi' | 'darurat'> = {
          rendah: 'normal',
          sedang: 'normal',
          tinggi: 'tinggi',
          darurat: 'darurat',
        };
        const apiRes = await fetch('/api/v1/webhooks/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reportId: selectedReport.id,
            agencyCode,
            priority: priorityMap[nextUrgency],
            summary: `[${selectedReport.rt}] ${selectedReport.title} — ${cleanNote || selectedReport.description}`,
          }),
        });
        const apiJson = (await apiRes.json()) as { referenceNumber?: string };
        const refNum = (apiJson.referenceNumber || `DISP-RW013-${Date.now()}`)
          .toUpperCase()
          .replace(/[^A-Z0-9\-]/g, '')
          .slice(0, 60);

        const dispatchId = generateSafeId('dsp');
        try {
          await setDoc(doc(db, 'agencyDispatches', dispatchId), {
            authorId: adminProfile.uid,
            reportId: selectedReport.id,
            agencyCode,
            agencyName: agencyLabel.slice(0, 100),
            priority: priorityMap[nextUrgency],
            dispatchStatus: nextStatus === 'selesai' ? 'selesai' : 'terkirim',
            referenceNumber: refNum,
            payloadSummary:
              `[${selectedReport.rt}] ${selectedReport.title} (${STATUS_LABELS[nextStatus]})`.slice(
                0,
                500
              ),
            rwCode: 'RW013',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          dispatchNote = ` · Tiket API: ${refNum}`;
        } catch (dispErr) {
          handleFirestoreError(dispErr, OperationType.CREATE, `agencyDispatches/${dispatchId}`);
        }
      }

      setSavingTriage(false);
      setActionFeedback(
        `Status diperbarui & notifikasi push terkirim ke pelapor${dispatchNote}`
      );
    } catch (error) {
      setSavingTriage(false);
      setActionError('Gagal menyimpan tindak lanjut. Periksa hak akses admin Anda.');
      handleFirestoreError(error, OperationType.UPDATE, reportPath);
    }
  };

  const handleDeleteReport = async (reportId: string) => {
    try {
      await deleteDoc(doc(db, 'reports', reportId));
      if (selectedReportId === reportId) {
        setSelectedReportId(null);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `reports/${reportId}`);
    }
  };

  const handleGrantOfficer = async (e: React.FormEvent) => {
    e.preventDefault();
    setGrantFeedback('');
    const cleanUid = newOfficerUid.trim();
    if (!VALIDATION_LIMITS.ID_REGEX.test(cleanUid)) {
      setGrantFeedback('UID tidak valid.');
      return;
    }
    try {
      await setDoc(doc(db, 'admins', cleanUid), {
        uid: cleanUid,
        grantedBy: adminProfile.uid,
        role: 'admin',
        createdAt: serverTimestamp(),
      });
      setNewOfficerUid('');
      setGrantFeedback(`Akses petugas admin diberikan untuk UID ${cleanUid}.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `admins/${cleanUid}`);
    }
  };

  return (
    <div className="space-y-5">
      {/* Admin Olive Header Card */}
      <section className="bg-[#586826] text-[#f7f9f4] rounded-3xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-base font-bold">Dashboard Admin & Triase</h1>
            <p className="text-xs text-[#dcecc3]/85">
              Verifikasi laporan warga, kirim push status, & teruskan API
            </p>
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#a5cf4c] shrink-0">
            <ShieldCheck className="w-4 h-4" />
            <span>Petugas</span>
          </span>
        </div>

        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="bg-[#48561e] rounded-2xl p-2.5">
            <p className="text-[10px] text-[#dcecc3]">Masuk</p>
            <p className="text-lg font-bold font-mono tabular-nums">{metrics.total}</p>
          </div>
          <div className="bg-[#48561e] rounded-2xl p-2.5">
            <p className="text-[10px] text-amber-200">Tunggu</p>
            <p className="text-lg font-bold font-mono tabular-nums">{metrics.waiting}</p>
          </div>
          <div className="bg-[#48561e] rounded-2xl p-2.5">
            <p className="text-[10px] text-[#dcecc3]">Proses</p>
            <p className="text-lg font-bold font-mono tabular-nums">{metrics.inProgress}</p>
          </div>
          <div className="bg-[#48561e] rounded-2xl p-2.5">
            <p className="text-[10px] text-[#a5cf4c]">Tuntas</p>
            <p className="text-lg font-bold font-mono tabular-nums">{metrics.completed}</p>
          </div>
        </div>
      </section>

      {/* Search & Filters */}
      <section className="bg-white border border-[#cbe0b0] rounded-3xl p-4 space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-[#5b6649] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari judul laporan, pelapor, atau alamat..."
            className="w-full min-h-[42px] pl-9 pr-3.5 py-2 text-xs bg-[#f7f9f4] border border-[#cbe0b0] rounded-full text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <select
            aria-label="Filter Kategori"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'ALL' | ReportCategory)}
            className="min-h-[40px] px-3 py-1.5 text-xs bg-[#f7f9f4] border border-[#cbe0b0] rounded-xl text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
          >
            <option value="ALL">Semua Kategori</option>
            {Object.values(CATEGORY_CATALOG).map((c) => (
              <option key={c.id} value={c.id}>
                {c.shortLabel}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter Wilayah RT"
            value={rtFilter}
            onChange={(e) => setRtFilter(e.target.value)}
            className="min-h-[40px] px-3 py-1.5 text-xs font-mono bg-[#f7f9f4] border border-[#cbe0b0] rounded-xl text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
          >
            <option value="ALL">Semua 10 RT</option>
            {RT_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {(
            ['ALL', 'menunggu', 'diverifikasi', 'diproses', 'selesai', 'ditolak'] as const
          ).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`min-h-[36px] px-3 py-1 text-xs font-semibold rounded-full transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                statusFilter === st
                  ? 'bg-[#a5cf4c] text-[#263015]'
                  : 'bg-[#f7f9f4] border border-[#cbe0b0] text-[#5b6649] hover:text-[#263015]'
              }`}
            >
              {st === 'ALL' ? 'Semua' : STATUS_LABELS[st]}
            </button>
          ))}
        </div>
      </section>

      {/* Incoming Queue Horizontal Olive-Thumbnail Cards */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-bold text-[#263015]">
            Antrean Laporan ({filteredReports.length})
          </h2>
          <span className="text-[11px] text-[#5b6649]">Ketuk kartu untuk triase</span>
        </div>

        {filteredReports.length === 0 ? (
          <div className="bg-white border border-[#cbe0b0] rounded-3xl p-7 text-center text-xs text-[#5b6649]">
            Tidak ada laporan yang cocok dengan filter saat ini.
          </div>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto phone-scroll pr-0.5">
            {filteredReports.map((rep) => {
              const isSelected = rep.id === selectedReport?.id;
              return (
                <button
                  key={rep.id}
                  type="button"
                  onClick={() => selectReportForTriage(rep)}
                  className={`w-full text-left p-3 rounded-2xl border transition-all flex items-center gap-3 cursor-pointer ${
                    isSelected
                      ? 'bg-[#dcecc3] border-[#586826] ring-2 ring-[#586826]/25'
                      : 'bg-white border-[#cbe0b0] hover:bg-[#f7f9f4]'
                  }`}
                >
                  <div className="w-14 h-14 rounded-xl bg-[#586826] text-[#dcecc3] overflow-hidden shrink-0 flex items-center justify-center">
                    {rep.photoDataUrl ? (
                      <img
                        src={rep.photoDataUrl}
                        alt={rep.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ImageIcon className="w-5 h-5" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-0.5">
                    <p className="text-[11px] text-[#5b6649] truncate">
                      <span className="font-mono font-semibold text-[#586826]">{rep.rt}</span> ·{' '}
                      {CATEGORY_CATALOG[rep.category]?.shortLabel} · {URGENCY_LABELS[rep.urgency]}
                    </p>
                    <p className="text-xs font-bold text-[#263015] truncate">{rep.title}</p>
                    <div className="flex items-center justify-between gap-2 text-[11px] text-[#5b6649]">
                      <span className="truncate">Oleh {rep.authorName}</span>
                      <span className="font-semibold text-[#263015] shrink-0">
                        {STATUS_LABELS[rep.status]}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Triage & Push Notification Dispatch Card */}
      <div
        ref={inspectorRef}
        className="bg-[#dcecc3] border border-[#cbe0b0] rounded-3xl p-4 space-y-4"
      >
        {!selectedReport ? (
          <div className="py-8 text-center text-xs text-[#5b6649]">
            Pilih salah satu kartu laporan di atas untuk memeriksa bukti foto, lokasi GPS, dan mengirim tindak lanjut.
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-[#cbe0b0] pb-3">
              <div className="min-w-0">
                <p className="text-[11px] text-[#5b6649]">
                  {selectedReport.rt} · {CATEGORY_CATALOG[selectedReport.category]?.shortLabel} ·{' '}
                  {formatTimestamp(selectedReport.createdAt)}
                </p>
                <h3 className="text-sm font-bold text-[#263015] mt-0.5 leading-snug">
                  {selectedReport.title}
                </h3>
                <p className="text-[11px] text-[#5b6649]">Pelapor: {selectedReport.authorName}</p>
              </div>
              <button
                type="button"
                onClick={() => handleDeleteReport(selectedReport.id)}
                title="Hapus laporan"
                className="min-h-[38px] min-w-[38px] rounded-xl bg-white/80 text-[#5b6649] hover:text-red-700 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {selectedReport.photoDataUrl ? (
              <img
                src={selectedReport.photoDataUrl}
                alt={selectedReport.title}
                referrerPolicy="no-referrer"
                className="w-full h-48 object-cover rounded-2xl border border-[#cbe0b0]"
              />
            ) : (
              <div className="w-full py-5 rounded-2xl bg-[#f7f9f4] border border-[#cbe0b0] text-center text-xs text-[#5b6649]">
                Laporan dikirim tanpa lampiran foto
              </div>
            )}

            <div className="bg-[#f7f9f4] border border-[#cbe0b0] rounded-2xl p-3.5 space-y-2 text-xs text-[#263015]">
              <p className="leading-relaxed">{selectedReport.description}</p>
              <div className="pt-2 border-t border-[#e6f2d3] flex items-center justify-between gap-2 text-[#5b6649]">
                <span className="inline-flex items-center gap-1 truncate">
                  <MapPin className="w-3.5 h-3.5 shrink-0 text-[#586826]" />
                  <span className="truncate">{selectedReport.address}</span>
                </span>
                <a
                  href={`https://www.openstreetmap.org/?mlat=${selectedReport.latitude}&mlon=${selectedReport.longitude}#map=18/${selectedReport.latitude}/${selectedReport.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-[#586826] font-semibold hover:underline shrink-0"
                >
                  <span>
                    {selectedReport.latitude.toFixed(4)}, {selectedReport.longitude.toFixed(4)}
                  </span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            <form
              onSubmit={handleSaveTriage}
              className="bg-[#f7f9f4] border border-[#cbe0b0] rounded-2xl p-4 space-y-3.5"
            >
              <h4 className="text-xs font-bold text-[#263015]">
                Formulir Tindak Lanjut & Notifikasi Push
              </h4>

              {actionFeedback && (
                <div className="p-3 rounded-xl bg-[#dcecc3] border border-[#586826]/30 text-xs text-[#263015] font-medium flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#586826] shrink-0 mt-0.5" />
                  <span>{actionFeedback}</span>
                </div>
              )}

              {actionError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
                  {actionError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label htmlFor="triage-status" className="block text-[11px] font-semibold text-[#263015]">
                    Status Laporan
                  </label>
                  <select
                    id="triage-status"
                    value={nextStatus}
                    onChange={(e) => setNextStatus(e.target.value as ReportStatus)}
                    className="w-full min-h-[42px] px-2.5 py-1.5 text-xs bg-white border border-[#cbe0b0] rounded-xl text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
                  >
                    {(Object.keys(STATUS_LABELS) as ReportStatus[]).map((st) => (
                      <option key={st} value={st}>
                        {STATUS_LABELS[st]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="triage-urgency" className="block text-[11px] font-semibold text-[#263015]">
                    Urgensi
                  </label>
                  <select
                    id="triage-urgency"
                    value={nextUrgency}
                    onChange={(e) => setNextUrgency(e.target.value as ReportUrgency)}
                    className="w-full min-h-[42px] px-2.5 py-1.5 text-xs bg-white border border-[#cbe0b0] rounded-xl text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
                  >
                    {(Object.keys(URGENCY_LABELS) as ReportUrgency[]).map((u) => (
                      <option key={u} value={u}>
                        {URGENCY_LABELS[u]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="space-y-1">
                  <label htmlFor="triage-cat" className="block text-[11px] font-semibold text-[#263015]">
                    Kategori Layanan
                  </label>
                  <select
                    id="triage-cat"
                    value={nextCategory}
                    onChange={(e) => {
                      const c = e.target.value as ReportCategory;
                      setNextCategory(c);
                      setAgencyCode(CATEGORY_CATALOG[c].defaultAgency);
                    }}
                    className="w-full min-h-[42px] px-2.5 py-1.5 text-xs bg-white border border-[#cbe0b0] rounded-xl text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
                  >
                    {Object.values(CATEGORY_CATALOG).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label htmlFor="triage-agency" className="block text-[11px] font-semibold text-[#263015]">
                    Instansi Tujuan
                  </label>
                  <select
                    id="triage-agency"
                    value={agencyCode}
                    onChange={(e) => setAgencyCode(e.target.value as AgencyCode)}
                    className="w-full min-h-[42px] px-2.5 py-1.5 text-xs bg-white border border-[#cbe0b0] rounded-xl text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
                  >
                    {(Object.keys(AGENCY_LABELS) as AgencyCode[]).map((code) => (
                      <option key={code} value={code}>
                        {AGENCY_LABELS[code]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="triage-note" className="block text-[11px] font-semibold text-[#263015]">
                  Catatan Petugas (Dikirim ke Notifikasi Push Warga)
                </label>
                <textarea
                  id="triage-note"
                  rows={3}
                  maxLength={VALIDATION_LIMITS.ADMIN_NOTE_MAX}
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  placeholder="Contoh: Petugas Puskesmas & pengurus RW dijadwalkan turun pukul 09.00 WIB..."
                  className="w-full px-3 py-2 text-xs bg-white border border-[#cbe0b0] rounded-xl text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-[#263015] cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendAgencyApiDispatch}
                  onChange={(e) => setSendAgencyApiDispatch(e.target.checked)}
                  className="rounded border-[#cbe0b0] text-[#586826] focus:ring-[#586826]"
                />
                <span>Teruskan juga tiket ke Gateway API Instansi</span>
              </label>

              <button
                type="submit"
                disabled={savingTriage}
                className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-[#f7f9f4] bg-[#586826] rounded-full hover:bg-[#48561e] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50"
              >
                {savingTriage ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Memproses & Mengirim Push...</span>
                  </>
                ) : (
                  <>
                    <BellRing className="w-4 h-4" />
                    <span>Simpan Status & Kirim Push</span>
                  </>
                )}
              </button>
            </form>
          </>
        )}
      </div>

      {/* Officer Delegation for Bootstrapped Admin */}
      {isBootstrappedAdmin && (
        <section className="bg-white border border-[#cbe0b0] rounded-3xl p-4 space-y-3">
          <div className="space-y-0.5">
            <h2 className="text-xs font-bold text-[#263015] flex items-center gap-1.5">
              <UserPlus className="w-4 h-4 text-[#586826]" />
              <span>Delegasi Petugas Admin Wilayah</span>
            </h2>
            <p className="text-[11px] text-[#5b6649]">
              Tambahkan UID warga/pengurus RW agar dapat memverifikasi laporan.
            </p>
            {grantFeedback && (
              <p className="text-xs font-semibold text-[#586826] pt-1">{grantFeedback}</p>
            )}
          </div>
          <form onSubmit={handleGrantOfficer} className="flex items-center gap-2">
            <input
              type="text"
              value={newOfficerUid}
              onChange={(e) => setNewOfficerUid(e.target.value)}
              placeholder="Masukkan UID Pengguna"
              className="flex-1 min-h-[42px] px-3.5 py-2 text-xs font-mono bg-[#f7f9f4] border border-[#cbe0b0] rounded-full text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
            />
            <button
              type="submit"
              className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#f7f9f4] bg-[#586826] rounded-full hover:bg-[#48561e] whitespace-nowrap cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Beri Akses</span>
            </button>
          </form>
        </section>
      )}
    </div>
  );
};
