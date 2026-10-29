import React, { useMemo, useState } from 'react';
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

      // 3. Optionally trigger Municipal Agency API Dispatch (/api/v1/webhooks/dispatch + agencyDispatches log)
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
        `Berhasil memperbarui status & mengirim notifikasi push ke pelapor${dispatchNote}`
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
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Dashboard Admin & Triase Laporan
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Verifikasi laporan warga secara efisien, teruskan ke instansi terkait melalui API, dan kirim pembaruan status via notifikasi push otomatis.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-800">
          <ShieldCheck className="w-4 h-4" />
          <span>Mode Petugas Terotorisasi</span>
        </span>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
          <p className="text-xs text-slate-500">Total Laporan Masuk</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
            {metrics.total}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
          <p className="text-xs text-slate-500">Menunggu Verifikasi</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-amber-700">
            {metrics.waiting}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
          <p className="text-xs text-slate-500">Sedang Ditindaklanjuti</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-sky-700">
            {metrics.inProgress}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
          <p className="text-xs text-slate-500">Selesai Ditangani</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-emerald-700">
            {metrics.completed}
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari judul laporan, nama pelapor, alamat, atau RT..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter Kategori"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as 'ALL' | ReportCategory)}
              className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
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
              className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="ALL">Semua RT</option>
              {RT_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Interactive Segmented Status Filter */}
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
          {(
            ['ALL', 'menunggu', 'diverifikasi', 'diproses', 'selesai', 'ditolak'] as const
          ).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                statusFilter === st
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {st === 'ALL' ? 'Semua Status' : STATUS_LABELS[st]}
            </button>
          ))}
        </div>
      </div>

      {/* Main Split: Incoming Queue Table + Triage Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Antrean Laporan Warga ({filteredReports.length})
            </h2>
            <span className="text-xs text-slate-500">Klik baris untuk menindaklanjuti</span>
          </div>

          {filteredReports.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              Tidak ada laporan yang cocok dengan filter saat ini.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="py-2.5 px-4 font-semibold">Laporan & Pelapor</th>
                    <th className="py-2.5 px-3 font-semibold">RT</th>
                    <th className="py-2.5 px-3 font-semibold">Urgensi</th>
                    <th className="py-2.5 px-3 font-semibold">Status</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Waktu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredReports.map((rep) => {
                    const isSelected = rep.id === selectedReport?.id;
                    return (
                      <tr
                        key={rep.id}
                        onClick={() => selectReportForTriage(rep)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-slate-100/90' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-3 px-4 max-w-xs">
                          <p className="font-semibold text-slate-900 truncate">{rep.title}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                            {CATEGORY_CATALOG[rep.category]?.shortLabel} · Oleh {rep.authorName}
                            {rep.visibility === 'private' ? ' · Tertutup' : ''}
                          </p>
                        </td>
                        <td className="py-3 px-3 font-mono whitespace-nowrap text-slate-800">
                          {rep.rt}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span
                            className={`font-medium ${
                              rep.urgency === 'darurat'
                                ? 'text-red-700 font-semibold'
                                : rep.urgency === 'tinggi'
                                ? 'text-amber-700 font-semibold'
                                : 'text-slate-700'
                            }`}
                          >
                            {URGENCY_LABELS[rep.urgency]}
                          </span>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span
                            className={`font-medium ${
                              rep.status === 'selesai'
                                ? 'text-emerald-700'
                                : rep.status === 'menunggu'
                                ? 'text-amber-700'
                                : rep.status === 'ditolak'
                                ? 'text-slate-400'
                                : 'text-sky-700'
                            }`}
                          >
                            {STATUS_LABELS[rep.status]}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-[11px] text-slate-500 whitespace-nowrap">
                          {formatTimestamp(rep.createdAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Column: Triage & Push Notification Dispatch */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-5">
          {!selectedReport ? (
            <div className="py-12 text-center text-sm text-slate-500">
              Pilih salah satu laporan di tabel sebelah kiri untuk memeriksa foto bukti, lokasi GPS, dan mengirim tindak lanjut.
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3.5">
                <div>
                  <p className="text-xs text-slate-500">
                    {selectedReport.rt} · {CATEGORY_CATALOG[selectedReport.category]?.label} · Pelapor:{' '}
                    {selectedReport.authorName}
                  </p>
                  <h3 className="text-base font-semibold text-slate-900 mt-0.5">
                    {selectedReport.title}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteReport(selectedReport.id)}
                  title="Hapus laporan"
                  className="p-1.5 text-slate-400 hover:text-red-700 rounded transition-colors cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {selectedReport.photoDataUrl ? (
                <img
                  src={selectedReport.photoDataUrl}
                  alt={selectedReport.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-52 object-cover rounded-lg border border-slate-200"
                />
              ) : (
                <div className="w-full h-24 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center text-xs text-slate-400">
                  Laporan dikirim tanpa lampiran foto
                </div>
              )}

              <div className="space-y-2 text-xs text-slate-700">
                <p className="leading-relaxed">{selectedReport.description}</p>
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-slate-600">
                  <span className="inline-flex items-center gap-1 truncate">
                    <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                    <span className="truncate">{selectedReport.address}</span>
                  </span>
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${selectedReport.latitude}&mlon=${selectedReport.longitude}#map=18/${selectedReport.latitude}/${selectedReport.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-slate-900 hover:underline shrink-0"
                  >
                    <span>
                      {selectedReport.latitude.toFixed(4)}, {selectedReport.longitude.toFixed(4)}
                    </span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              <form onSubmit={handleSaveTriage} className="space-y-4 pt-3 border-t border-slate-200">
                <h4 className="text-xs font-semibold text-slate-900">
                  Formulir Tindak Lanjut & Notifikasi Push
                </h4>

                {actionFeedback && (
                  <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{actionFeedback}</span>
                  </div>
                )}

                {actionError && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                    {actionError}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="triage-status" className="block text-xs font-medium text-slate-700">
                      Status Laporan
                    </label>
                    <select
                      id="triage-status"
                      value={nextStatus}
                      onChange={(e) => setNextStatus(e.target.value as ReportStatus)}
                      className="w-full px-2.5 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                    >
                      {(Object.keys(STATUS_LABELS) as ReportStatus[]).map((st) => (
                        <option key={st} value={st}>
                          {STATUS_LABELS[st]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="triage-urgency" className="block text-xs font-medium text-slate-700">
                      Klasifikasi Urgensi
                    </label>
                    <select
                      id="triage-urgency"
                      value={nextUrgency}
                      onChange={(e) => setNextUrgency(e.target.value as ReportUrgency)}
                      className="w-full px-2.5 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                    >
                      {(Object.keys(URGENCY_LABELS) as ReportUrgency[]).map((u) => (
                        <option key={u} value={u}>
                          {URGENCY_LABELS[u]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="triage-cat" className="block text-xs font-medium text-slate-700">
                      Kategorisasi Terstruktur
                    </label>
                    <select
                      id="triage-cat"
                      value={nextCategory}
                      onChange={(e) => {
                        const c = e.target.value as ReportCategory;
                        setNextCategory(c);
                        setAgencyCode(CATEGORY_CATALOG[c].defaultAgency);
                      }}
                      className="w-full px-2.5 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                    >
                      {Object.values(CATEGORY_CATALOG).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.shortLabel}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="triage-agency" className="block text-xs font-medium text-slate-700">
                      Instansi Terkait Tujuan
                    </label>
                    <select
                      id="triage-agency"
                      value={agencyCode}
                      onChange={(e) => setAgencyCode(e.target.value as AgencyCode)}
                      className="w-full px-2.5 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
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
                  <label htmlFor="triage-note" className="block text-xs font-medium text-slate-700">
                    Catatan Tindak Lanjut Petugas (Dikirim ke Notifikasi Push Warga)
                  </label>
                  <textarea
                    id="triage-note"
                    rows={3}
                    maxLength={VALIDATION_LIMITS.ADMIN_NOTE_MAX}
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    placeholder="Contoh: Petugas Jumantik & Puskesmas dijadwalkan turun ke lokasi pukul 09.00 WIB..."
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendAgencyApiDispatch}
                    onChange={(e) => setSendAgencyApiDispatch(e.target.checked)}
                    className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  <span>Teruskan juga payload tiket ke Gateway API Instansi Terkait</span>
                </label>

                <button
                  type="submit"
                  disabled={savingTriage}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {savingTriage ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Memproses Pembaruan & Push...</span>
                    </>
                  ) : (
                    <>
                      <BellRing className="w-3.5 h-3.5" />
                      <span>Simpan Status & Kirim Notifikasi Push</span>
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      {/* Optional Officer Delegation for Bootstrapped Admin */}
      {isBootstrappedAdmin && (
        <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-slate-700" />
              <span>Delegasi Petugas Admin Wilayah</span>
            </h2>
            <p className="text-xs text-slate-500">
              Tambahkan UID warga/pengurus RW terdaftar agar memiliki hak verifikasi laporan pada koleksi RBAC.
            </p>
            {grantFeedback && (
              <p className="text-xs font-medium text-emerald-700 pt-1">{grantFeedback}</p>
            )}
          </div>
          <form onSubmit={handleGrantOfficer} className="flex items-center gap-2 shrink-0">
            <input
              type="text"
              value={newOfficerUid}
              onChange={(e) => setNewOfficerUid(e.target.value)}
              placeholder="Masukkan UID Pengguna"
              className="px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
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
