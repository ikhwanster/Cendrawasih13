import React from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Bell, BellRing, Check, CheckCheck, X } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { STATUS_LABELS, type PushNotificationItem } from '../types';
import { formatTimestamp } from '../utils/geoAndImage';

interface NotificationDrawerProps {
  open: boolean;
  onClose: () => void;
  notifications: PushNotificationItem[];
  browserPermission: NotificationPermission | 'unsupported';
  onRequestBrowserPermission: () => void;
}

export const NotificationDrawer: React.FC<NotificationDrawerProps> = ({
  open,
  onClose,
  notifications,
  browserPermission,
  onRequestBrowserPermission,
}) => {
  if (!open) return null;

  const markAsRead = async (item: PushNotificationItem) => {
    if (item.read) return;
    try {
      await updateDoc(doc(db, 'notifications', item.id), {
        read: true,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `notifications/${item.id}`);
    }
  };

  const markAllRead = async () => {
    const unread = notifications.filter((n) => !n.read);
    for (const item of unread) {
      await markAsRead(item);
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30">
      <div className="w-full max-w-md bg-white h-full border-l border-slate-200 flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-slate-800" />
            <h2 className="text-base font-semibold text-slate-900">
              Notifikasi Status Laporan ({unreadCount} belum dibaca)
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Browser Push Notification Enablement Strip */}
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 text-xs">
          <div className="space-y-0.5">
            <p className="font-medium text-slate-800">Notifikasi Push Peramban</p>
            <p className="text-slate-500">
              {browserPermission === 'granted'
                ? 'Aktif — Anda menerima peringatan instan saat status laporan berubah.'
                : browserPermission === 'denied'
                ? 'Diblokir oleh pengaturan peramban. Notifikasi tetap tampil real-time di sini.'
                : browserPermission === 'unsupported'
                ? 'Menggunakan mode notifikasi real-time dalam aplikasi.'
                : 'Aktifkan agar pembaruan status muncul sebagai push di layar perangkat Anda.'}
            </p>
          </div>
          {browserPermission === 'default' && (
            <button
              type="button"
              onClick={onRequestBrowserPermission}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <BellRing className="w-3.5 h-3.5" />
              <span>Aktifkan Push</span>
            </button>
          )}
        </div>

        {unreadCount > 0 && (
          <div className="px-5 py-2.5 border-b border-slate-100 flex justify-end">
            <button
              type="button"
              onClick={markAllRead}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 cursor-pointer"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Tandai semua sudah dibaca</span>
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              Belum ada notifikasi pembaruan status laporan. Saat petugas memverifikasi atau menyelesaikan laporan Anda, pemberitahuan akan muncul otomatis secara real-time.
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={`p-4 space-y-1.5 transition-colors ${
                  n.read ? 'bg-white' : 'bg-slate-50/90'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-900 leading-snug">
                    {n.reportTitle}
                  </p>
                  {!n.read && (
                    <button
                      type="button"
                      onClick={() => markAsRead(n)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 hover:text-slate-900 shrink-0 cursor-pointer"
                    >
                      <Check className="w-3 h-3" />
                      <span>Dibaca</span>
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{n.message}</p>
                <div className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="font-medium text-slate-700">
                    {STATUS_LABELS[n.newStatus]}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{formatTimestamp(n.createdAt)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
