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
    <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-xs">
      <div className="w-full bg-[#f7f9f4] border-t border-[#cbe0b0] rounded-t-3xl max-h-[85%] flex flex-col overflow-hidden shadow-xl">
        {/* Bottom Sheet Grab Handle */}
        <div className="w-10 h-1.5 bg-[#586826]/25 rounded-full mx-auto mt-3" />

        <div className="px-5 py-3.5 border-b border-[#cbe0b0] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-full bg-[#586826] text-[#dcecc3] flex items-center justify-center shrink-0">
              <Bell className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-[#263015] truncate">
                Notifikasi Push Status
              </h2>
              <p className="text-[11px] text-[#5b6649]">
                {unreadCount} pemberitahuan belum dibaca
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup notifikasi"
            className="min-h-[40px] min-w-[40px] rounded-full bg-[#e6f2d3] text-[#586826] hover:bg-[#dcecc3] flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Browser Push Notification Enablement Strip */}
        <div className="px-5 py-3 bg-[#dcecc3] border-b border-[#cbe0b0] flex items-center justify-between gap-3 text-xs">
          <div className="space-y-0.5">
            <p className="font-semibold text-[#263015]">Notifikasi Push Perangkat</p>
            <p className="text-[11px] text-[#5b6649] leading-snug">
              {browserPermission === 'granted'
                ? 'Aktif — Peringatan instan muncul saat status laporan diperbarui.'
                : browserPermission === 'denied'
                ? 'Diblokir peramban. Pembaruan tetap tampil real-time di sini.'
                : browserPermission === 'unsupported'
                ? 'Mode notifikasi real-time dalam aplikasi aktif.'
                : 'Aktifkan agar pembaruan status muncul langsung di layar Anda.'}
            </p>
          </div>
          {browserPermission === 'default' && (
            <button
              type="button"
              onClick={onRequestBrowserPermission}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#f7f9f4] bg-[#586826] rounded-full hover:bg-[#48561e] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <BellRing className="w-3.5 h-3.5" />
              <span>Aktifkan</span>
            </button>
          )}
        </div>

        {unreadCount > 0 && (
          <div className="px-5 py-2 border-b border-[#e6f2d3] flex justify-end">
            <button
              type="button"
              onClick={markAllRead}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#586826] hover:underline cursor-pointer"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Tandai semua dibaca</span>
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto phone-scroll p-3.5 space-y-2.5">
          {notifications.length === 0 ? (
            <div className="py-10 px-4 text-center text-xs text-[#5b6649] leading-relaxed">
              Belum ada pembaruan status laporan. Saat petugas RW atau instansi menindaklanjuti laporan Anda, notifikasi akan muncul otomatis secara real-time.
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={`p-3.5 rounded-2xl border space-y-1.5 transition-colors ${
                  n.read
                    ? 'bg-white border-[#cbe0b0]'
                    : 'bg-[#e6f2d3] border-[#586826]/40'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-bold text-[#263015] leading-snug">
                    {n.reportTitle}
                  </p>
                  {!n.read && (
                    <button
                      type="button"
                      onClick={() => markAsRead(n)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#586826] text-[#f7f9f4] text-[10px] font-semibold shrink-0 cursor-pointer"
                    >
                      <Check className="w-3 h-3" />
                      <span>Dibaca</span>
                    </button>
                  )}
                </div>
                <p className="text-xs text-[#5b6649] leading-relaxed">{n.message}</p>
                <div className="flex items-center gap-2 text-[11px] text-[#5b6649]">
                  <span className="font-semibold text-[#586826]">
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
