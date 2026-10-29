import type { Timestamp } from 'firebase/firestore';
import {
  RT_UNITS,
  VALIDATION_LIMITS,
  type CitizenReport,
  type JumantikLog,
  type RtUnit,
} from '../types';

export const DEFAULT_RW013_CENTER = {
  lat: -6.2297,
  lng: 106.8295,
};

export function generateSafeId(prefix = 'doc'): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function formatTimestamp(ts?: Timestamp | null): string {
  if (!ts || typeof ts.toDate !== 'function') return 'Baru saja';
  const d = ts.toDate();
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function timestampToMillis(ts?: Timestamp | null): number {
  if (!ts || typeof ts.toMillis !== 'function') return Date.now();
  return ts.toMillis();
}

export function getIsoWeekKey(dateStr: string): string {
  const parts = dateStr.split('-').map(Number);
  const year = parts[0] || new Date().getFullYear();
  const month = (parts[1] || 1) - 1;
  const day = parts[2] || 1;
  const date = new Date(Date.UTC(year, month, day));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export async function compressImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Format gambar tidak didukung.'));
      img.onload = () => {
        const maxSide = 880;
        let width = img.width;
        let height = img.height;
        if (width > maxSide || height > maxSide) {
          if (width >= height) {
            height = Math.round((height * maxSide) / width);
            width = maxSide;
          } else {
            width = Math.round((width * maxSide) / height);
            height = maxSide;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas tidak tersedia di peramban ini.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        let quality = 0.74;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > VALIDATION_LIMITS.PHOTO_MAX_CHARS - 20000 && quality > 0.35) {
          quality -= 0.12;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        if (dataUrl.length > VALIDATION_LIMITS.PHOTO_MAX_CHARS) {
          reject(new Error('Ukuran foto terlalu besar setelah kompresi. Gunakan resolusi lebih kecil.'));
          return;
        }
        resolve(dataUrl);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export async function reverseGeocodeCoordinates(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `/api/v1/geocode/reverse?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(
        String(lng)
      )}`
    );
    if (!res.ok) {
      return `Titik GPS (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
    }
    const data = (await res.json()) as { address?: string };
    return (data.address || `Titik GPS (${lat.toFixed(5)}, ${lng.toFixed(5)})`).slice(
      0,
      VALIDATION_LIMITS.ADDRESS_MAX
    );
  } catch {
    return `Titik GPS (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
  }
}

export interface SpatialHotspot {
  id: string;
  rt: RtUnit;
  lat: number;
  lng: number;
  reportCount: number;
  unresolvedCount: number;
  highUrgencyCount: number;
  abjPercent: number | null;
  riskScore: number;
  riskLevel: 'tinggi' | 'waspada' | 'terkendali';
  dominantCategory: string;
}

const URGENCY_WEIGHT: Record<string, number> = {
  rendah: 1,
  sedang: 2,
  tinggi: 4,
  darurat: 6,
};

export function computeRtVulnerability(
  reports: CitizenReport[],
  jumantikLogs: JumantikLog[]
): SpatialHotspot[] {
  return RT_UNITS.map((rt, idx) => {
    const rtReports = reports.filter((r) => r.rt === rt);
    const rtLogs = jumantikLogs.filter((l) => l.rt === rt);

    const inspected = rtLogs.reduce((acc, l) => acc + l.housesInspected, 0);
    const positive = rtLogs.reduce((acc, l) => acc + l.housesWithLarvae, 0);
    const abjPercent =
      inspected > 0 ? Number((((inspected - positive) / inspected) * 100).toFixed(1)) : null;

    let lat = DEFAULT_RW013_CENTER.lat + ((idx % 4) - 1.5) * 0.0018;
    let lng = DEFAULT_RW013_CENTER.lng + (Math.floor(idx / 4) - 1) * 0.0022;

    if (rtReports.length > 0) {
      lat = rtReports.reduce((sum, r) => sum + r.latitude, 0) / rtReports.length;
      lng = rtReports.reduce((sum, r) => sum + r.longitude, 0) / rtReports.length;
    } else if (rtLogs.length > 0) {
      lat = rtLogs.reduce((sum, l) => sum + l.latitude, 0) / rtLogs.length;
      lng = rtLogs.reduce((sum, l) => sum + l.longitude, 0) / rtLogs.length;
    }

    const unresolvedCount = rtReports.filter(
      (r) => r.status !== 'selesai' && r.status !== 'ditolak'
    ).length;
    const highUrgencyCount = rtReports.filter(
      (r) => r.urgency === 'tinggi' || r.urgency === 'darurat'
    ).length;

    const weightedReportScore = rtReports.reduce(
      (sum, r) =>
        sum +
        (URGENCY_WEIGHT[r.urgency] || 1) * (r.status === 'selesai' ? 0.4 : 1.0),
      0
    );

    const abjPenalty = abjPercent !== null && abjPercent < 95 ? (95 - abjPercent) * 1.4 : 0;
    const riskScore = Number((weightedReportScore * 4 + abjPenalty).toFixed(1));

    let riskLevel: 'tinggi' | 'waspada' | 'terkendali' = 'terkendali';
    if (riskScore >= 18 || (abjPercent !== null && abjPercent < 90) || highUrgencyCount >= 2) {
      riskLevel = 'tinggi';
    } else if (riskScore >= 8 || (abjPercent !== null && abjPercent < 95) || unresolvedCount >= 1) {
      riskLevel = 'waspada';
    }

    const catCounts: Record<string, number> = {};
    for (const r of rtReports) {
      catCounts[r.category] = (catCounts[r.category] || 0) + 1;
    }
    let dominantCategory = 'kesehatan_jentik';
    let topCount = 0;
    for (const [cat, c] of Object.entries(catCounts)) {
      if (c > topCount) {
        topCount = c;
        dominantCategory = cat;
      }
    }

    return {
      id: `hotspot_${rt.replace(/\s+/g, '')}`,
      rt,
      lat,
      lng,
      reportCount: rtReports.length,
      unresolvedCount,
      highUrgencyCount,
      abjPercent,
      riskScore,
      riskLevel,
      dominantCategory,
    };
  });
}
