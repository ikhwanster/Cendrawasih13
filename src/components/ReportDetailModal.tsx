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
    if (cleanTitle.length < VALIDATION_LIMITS.TITLE_MIN || cleanDesc.length < VALIDATION_LIMITS.DESC_MIN) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40">
      <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="space-y-1">
            <p className="text-xs text-slate-500">
              {catMeta?.label || report.category} · {report.rt} · {URGENCY_LABELS[report.urgency]}
            </p>
            <h2 className="text-lg font-semibold text-slate-900 leading-snug">{report.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {report.photoDataUrl ? (
          <img
            src={report.photoDataUrl}
            alt={report.title}
            referrerPolicy="no-referrer"
            className="w-full max-h-80 object-cover rounded-lg border border-slate-200"
          />
        ) : null}

        {editing ? (
          <form onSubmit={handleAuthorUpdate} className="space-y-3 bg-slate-50 border border-slate-200 rounded-lg p-4">
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-700">Judul Laporan</label>
              <input
                type="text"
                required
                minLength={VALIDATION_LIMITS.TITLE_MIN}
                maxLength={VALIDATION_LIMITS.TITLE_MAX}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-700">Deskripsi</label>
              <textarea
                rows={3}
                required
                minLength={VALIDATION_LIMITS.DESC_MIN}
                maxLength={VALIDATION_LIMITS.DESC_MAX}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-700">Urgensi</label>
              <select
                value={editUrgency}
                onChange={(e) => setEditUrgency(e.target.value as ReportUrgency)}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
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
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Simpan Perubahan</span>
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4 text-sm text-slate-700">
            <p className="leading-relaxed whitespace-pre-line">{report.description}</p>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
                  <MapPin className="w-3.5 h-3.5 text-slate-500" />
                  <span>{report.address}</span>
                </span>
                <a
                  href={`https://www.openstreetmap.org/?mlat=${report.latitude}&mlon=${report.longitude}#map=18/${report.latitude}/${report.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-slate-900 hover:underline shrink-0"
                >
                  <span>
                    {report.latitude.toFixed(5)}, {report.longitude.toFixed(5)}
                  </span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-slate-500 pt-1 border-t border-slate-200">
                <span>Pelapor: {report.authorName}</span>
                <span aria-hidden="true">·</span>
                <span>Status: <strong className="text-slate-900">{STATUS_LABELS[report.status]}</strong></span>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{formatTimestamp(report.createdAt)}</span>
              </div>
            </div>

            {(report.assignedAgency || report.adminNote) && (
              <div className="bg-emerald-50/60 border border-emerald-200 rounded-lg p-4 space-y-1.5 text-xs">
                <p className="font-semibold text-emerald-950 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Tanggapan Resmi Petugas & Instansi</span>
                </p>
                {report.assignedAgency && (
                  <p className="text-emerald-900 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Instansi Penanggung Jawab: <strong>{report.assignedAgency}</strong></span>
                  </p>
                )}
                {report.adminNote && (
                  <p className="text-slate-700 leading-relaxed pt-1">{report.adminNote}</p>
                )}
              </div>
            )}
          </div>
        )}

        {canAuthorModify && !editing && (
          <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-xs">
            <span className="text-slate-500">
              Laporan masih menunggu verifikasi dan dapat disunting.
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={startEditing}
                className="inline-flex items-center gap-1 font-medium text-slate-800 hover:underline cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Sunting</span>
              </button>
              <button
                type="button"
                onClick={handleAuthorDelete}
                className="inline-flex items-center gap-1 font-medium text-red-700 hover:underline cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Batalkan Laporan</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
