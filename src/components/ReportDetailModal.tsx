import React, { useState } from 'react';
import { deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  Building2,
  CheckCircle2,
  Edit3,
  ExternalLink,
  Loader2,
  MapPin,
  Trash2,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  CATEGORY_CATALOG,
  STATUS_LABELS,
  URGENCY_LABELS,
  VALIDATION_LIMITS,
  type CitizenReport,
  type ReportUrgency,
} from '../types';
import { formatTimestamp } from '../utils/geoAndImage';

interface ReportDetailModalProps {
  report: CitizenReport | null;
  currentUserId: string;
  onClose: () => void;
}

export const ReportDetailModal: React.FC<ReportDetailModalProps> = ({
  report,
  currentUserId,
  onClose,
}) => {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(report?.title || '');
  const [editDescription, setEditDescription] = useState(report?.description || '');
  const [editUrgency, setEditUrgency] = useState<ReportUrgency>(report?.urgency || 'sedang');
  const [saving, setSaving] = useState(false);

  if (!report) return null;

  const isAuthor = report.authorId === currentUserId;
  const canAuthorModify = isAuthor && report.status === 'menunggu';
  const catMeta = CATEGORY_CATALOG[report.category];

  const startEditing = () => {
    setEditTitle(report.title);
    setEditDescription(report.description);
    setEditUrgency(report.urgency);
    setEditing(true);
  };

  const handleAuthorUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAuthorModify) return;
    const cleanTitle = editTitle.trim().slice(0, VALIDATION_LIMITS.TITLE_MAX);
    const cleanDesc = editDescription.trim().slice(0, VALIDATION_LIMITS.DESC_MAX);
    if (
      cleanTitle.length < VALIDATION_LIMITS.TITLE_MIN ||
      cleanDesc.length < VALIDATION_LIMITS.DESC_MIN
    ) {
      return;
    }

    setSaving(true);
    try {
      await updateDoc(doc(db, 'reports', report.id), {
        title: cleanTitle,
        description: cleanDesc,
        urgency: editUrgency,
        updatedAt: serverTimestamp(),
      });
      setSaving(false);
      setEditing(false);
    } catch (error) {
      setSaving(false);
      handleFirestoreError(error, OperationType.UPDATE, `reports/${report.id}`);
    }
  };

  const handleAuthorDelete = async () => {
    if (!canAuthorModify) return;
    try {
      await deleteDoc(doc(db, 'reports', report.id));
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `reports/${report.id}`);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-xs">
      <div className="bg-[#f7f9f4] border-t border-[#cbe0b0] rounded-t-3xl w-full max-h-[88%] overflow-y-auto phone-scroll p-5 space-y-4 shadow-xl">
        {/* Bottom Sheet Grab Handle */}
        <div className="w-10 h-1.5 bg-[#586826]/25 rounded-full mx-auto -mt-1" />

        <div className="flex items-start justify-between gap-3 border-b border-[#cbe0b0] pb-3.5">
          <div className="space-y-1 min-w-0">
            <p className="text-xs text-[#5b6649]">
              <span className="font-semibold text-[#586826]">
                {catMeta?.shortLabel || report.category}
              </span>{' '}
              · <span className="font-mono">{report.rt}</span> · {URGENCY_LABELS[report.urgency]}
            </p>
            <h2 className="text-base font-bold text-[#263015] leading-snug">{report.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup rincian laporan"
            className="min-h-[40px] min-w-[40px] rounded-full bg-[#e6f2d3] text-[#586826] hover:bg-[#dcecc3] flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {report.photoDataUrl ? (
          <img
            src={report.photoDataUrl}
            alt={report.title}
            referrerPolicy="no-referrer"
            className="w-full max-h-64 object-cover rounded-2xl border border-[#cbe0b0]"
          />
        ) : null}

        {editing ? (
          <form
            onSubmit={handleAuthorUpdate}
            className="space-y-3 bg-[#dcecc3] border border-[#cbe0b0] rounded-2xl p-4"
          >
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-[#263015]">Judul Laporan</label>
              <input
                type="text"
                required
                minLength={VALIDATION_LIMITS.TITLE_MIN}
                maxLength={VALIDATION_LIMITS.TITLE_MAX}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-[#cbe0b0] rounded-xl text-[#263015]"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-[#263015]">Deskripsi</label>
              <textarea
                rows={3}
                required
                minLength={VALIDATION_LIMITS.DESC_MIN}
                maxLength={VALIDATION_LIMITS.DESC_MAX}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-[#cbe0b0] rounded-xl text-[#263015]"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-[#263015]">Urgensi</label>
              <select
                value={editUrgency}
                onChange={(e) => setEditUrgency(e.target.value as ReportUrgency)}
                className="w-full min-h-[42px] px-3 py-2 text-xs bg-white border border-[#cbe0b0] rounded-xl text-[#263015]"
              >
                {(Object.keys(URGENCY_LABELS) as ReportUrgency[]).map((u) => (
                  <option key={u} value={u}>
                    {URGENCY_LABELS[u]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="min-h-[40px] px-3.5 py-1.5 text-xs font-semibold text-[#5b6649] hover:text-[#263015] cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-[#f7f9f4] bg-[#586826] rounded-full hover:bg-[#48561e] cursor-pointer"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Simpan Perubahan</span>
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-3.5 text-sm text-[#263015]">
            <p className="leading-relaxed whitespace-pre-line text-xs">{report.description}</p>

            <div className="bg-white border border-[#cbe0b0] rounded-2xl p-3.5 space-y-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <span className="inline-flex items-start gap-1.5 font-medium text-[#263015]">
                  <MapPin className="w-3.5 h-3.5 text-[#586826] shrink-0 mt-0.5" />
                  <span>{report.address}</span>
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#e6f2d3]">
                <span className="text-[11px] text-[#5b6649]">Koordinat GPS</span>
                <a
                  href={`https://www.openstreetmap.org/?mlat=${report.latitude}&mlon=${report.longitude}#map=18/${report.latitude}/${report.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-[#586826] hover:underline shrink-0"
                >
                  <span>
                    {report.latitude.toFixed(5)}, {report.longitude.toFixed(5)}
                  </span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#5b6649] pt-1 border-t border-[#e6f2d3]">
                <span>Oleh {report.authorName}</span>
                <span aria-hidden="true">·</span>
                <strong className="text-[#586826]">{STATUS_LABELS[report.status]}</strong>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{formatTimestamp(report.createdAt)}</span>
              </div>
            </div>

            {(report.assignedAgency || report.adminNote) && (
              <div className="bg-[#dcecc3] border border-[#586826]/35 rounded-2xl p-3.5 space-y-1.5 text-xs">
                <p className="font-bold text-[#263015] flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-[#586826]" />
                  <span>Tanggapan Resmi Petugas & Instansi</span>
                </p>
                {report.assignedAgency && (
                  <p className="text-[#263015] flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-[#586826] shrink-0" />
                    <span>
                      Instansi: <strong>{report.assignedAgency}</strong>
                    </span>
                  </p>
                )}
                {report.adminNote && (
                  <p className="text-[#263015]/90 leading-relaxed pt-0.5">{report.adminNote}</p>
                )}
              </div>
            )}
          </div>
        )}

        {canAuthorModify && !editing && (
          <div className="pt-3 border-t border-[#cbe0b0] flex items-center justify-between gap-2 text-xs">
            <span className="text-[#5b6649] text-[11px]">Menunggu verifikasi</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={startEditing}
                className="min-h-[38px] inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-[#e6f2d3] font-semibold text-[#586826] hover:bg-[#dcecc3] cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Sunting</span>
              </button>
              <button
                type="button"
                onClick={handleAuthorDelete}
                className="min-h-[38px] inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-red-50 font-semibold text-red-700 hover:bg-red-100 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Batalkan</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
