import type { Timestamp } from 'firebase/firestore';

export type RtUnit =
  | 'RT 001'
  | 'RT 002'
  | 'RT 003'
  | 'RT 004'
  | 'RT 005'
  | 'RT 006'
  | 'RT 007'
  | 'RT 008'
  | 'RT 009'
  | 'RT 010';

export const RT_UNITS: RtUnit[] = [
  'RT 001',
  'RT 002',
  'RT 003',
  'RT 004',
  'RT 005',
  'RT 006',
  'RT 007',
  'RT 008',
  'RT 009',
  'RT 010',
];

export type ReportCategory =
  | 'kesehatan_jentik'
  | 'infrastruktur'
  | 'kebersihan'
  | 'drainase_banjir'
  | 'keamanan'
  | 'fasilitas_umum';

export type ReportUrgency = 'rendah' | 'sedang' | 'tinggi' | 'darurat';

export type ReportStatus = 'menunggu' | 'diverifikasi' | 'diproses' | 'selesai' | 'ditolak';

export type AgencyCode =
  | 'PUSKESMAS_RW013'
  | 'DINAS_PU'
  | 'DLH_KEBERSIHAN'
  | 'DINAS_SDA'
  | 'SATPOL_PP'
  | 'DISHUB_PJU';

// Validation constants synchronized verbatim with firebase-blueprint.json & firestore.rules
export const VALIDATION_LIMITS = {
  ID_REGEX: /^[a-zA-Z0-9_\-]+$/,
  DATE_REGEX: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
  WEEK_REGEX: /^[0-9]{4}-W[0-9]{2}$/,
  REF_REGEX: /^[A-Z0-9\-]+$/,
  DISPLAY_NAME_MAX: 80,
  TITLE_MIN: 3,
  TITLE_MAX: 120,
  DESC_MIN: 5,
  DESC_MAX: 1500,
  ADDRESS_MAX: 300,
  PHOTO_MAX_CHARS: 750000,
  ADMIN_NOTE_MAX: 1000,
  JUMANTIK_MAX_HOUSES: 500,
  JUMANTIK_FIELD_MAX: 300,
  JUMANTIK_NOTES_MAX: 500,
} as const;

export interface CategoryMeta {
  id: ReportCategory;
  label: string;
  shortLabel: string;
  defaultAgency: AgencyCode;
  slaHours: number;
  markerHex: string;
  description: string;
}

export const CATEGORY_CATALOG: Record<ReportCategory, CategoryMeta> = {
  kesehatan_jentik: {
    id: 'kesehatan_jentik',
    label: 'Kesehatan & Jentik (DBD)',
    shortLabel: 'Kesehatan / Jentik',
    defaultAgency: 'PUSKESMAS_RW013',
    slaHours: 12,
    markerHex: '#dc2626',
    description: 'Temuan jentik nyamuk, kasus suspek DBD, fogging, atau sanitasi warga.',
  },
  drainase_banjir: {
    id: 'drainase_banjir',
    label: 'Drainase & Genangan Banjir',
    shortLabel: 'Drainase / Banjir',
    defaultAgency: 'DINAS_SDA',
    slaHours: 6,
    markerHex: '#0284c7',
    description: 'Saluran air tersumbat, tanggul retak, atau genangan banjir di jalan lingkungan.',
  },
  infrastruktur: {
    id: 'infrastruktur',
    label: 'Infrastruktur & Jalan',
    shortLabel: 'Infrastruktur',
    defaultAgency: 'DINAS_PU',
    slaHours: 48,
    markerHex: '#d97706',
    description: 'Jalan berlubang, jembatan warga rusak, paving ambles, atau trotoar.',
  },
  kebersihan: {
    id: 'kebersihan',
    label: 'Kebersihan & Persampahan',
    shortLabel: 'Kebersihan',
    defaultAgency: 'DLH_KEBERSIHAN',
    slaHours: 24,
    markerHex: '#16a34a',
    description: 'Tumpukan sampah liar, keterlambatan angkut TPS, atau limbah lingkungan.',
  },
  keamanan: {
    id: 'keamanan',
    label: 'Keamanan & Ketertiban',
    shortLabel: 'Keamanan',
    defaultAgency: 'SATPOL_PP',
    slaHours: 4,
    markerHex: '#4f46e5',
    description: 'Gangguan ketertiban umum, pos kamling, atau kerawanan malam hari.',
  },
  fasilitas_umum: {
    id: 'fasilitas_umum',
    label: 'Penerangan & Fasilitas Umum',
    shortLabel: 'Fasilitas / PJU',
    defaultAgency: 'DISHUB_PJU',
    slaHours: 36,
    markerHex: '#475569',
    description: 'Lampu penerangan jalan umum (PJU) padam, kabel menjuntai, atau taman RW.',
  },
};

export const AGENCY_LABELS: Record<AgencyCode, string> = {
  PUSKESMAS_RW013: 'Puskesmas & Kader Jumantik RW 013',
  DINAS_PU: 'Dinas Bina Marga & PU',
  DLH_KEBERSIHAN: 'Dinas Lingkungan Hidup (DLH)',
  DINAS_SDA: 'Dinas Sumber Daya Air (SDA)',
  SATPOL_PP: 'Satpol PP & Bhabinkamtibmas',
  DISHUB_PJU: 'Dishub Unit PJU & Fasilitas',
};

export const STATUS_LABELS: Record<ReportStatus, string> = {
  menunggu: 'Menunggu Verifikasi',
  diverifikasi: 'Diverifikasi',
  diproses: 'Sedang Diproses',
  selesai: 'Selesai Ditangani',
  ditolak: 'Ditolak / Tidak Valid',
};

export const URGENCY_LABELS: Record<ReportUrgency, string> = {
  rendah: 'Rendah',
  sedang: 'Sedang',
  tinggi: 'Tinggi',
  darurat: 'Darurat',
};

export interface UserPublicProfile {
  uid: string;
  displayName: string;
  rt: RtUnit;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface CitizenReport {
  id: string;
  authorId: string;
  authorName: string;
  title: string;
  description: string;
  category: ReportCategory;
  urgency: ReportUrgency;
  status: ReportStatus;
  rt: RtUnit;
  rwCode: 'RW013';
  visibility: 'public' | 'private';
  latitude: number;
  longitude: number;
  address: string;
  photoDataUrl: string;
  assignedAgency: string;
  adminNote: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface JumantikLog {
  id: string;
  authorId: string;
  inspectionDate: string;
  weekKey: string;
  rt: RtUnit;
  rwCode: 'RW013';
  officerName: string;
  housesInspected: number;
  housesWithLarvae: number;
  larvaeLocations: string;
  actionTaken: string;
  notes: string;
  latitude: number;
  longitude: number;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface PushNotificationItem {
  id: string;
  recipientId: string;
  senderId: string;
  reportId: string;
  reportTitle: string;
  newStatus: ReportStatus;
  message: string;
  read: boolean;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface AgencyDispatchItem {
  id: string;
  authorId: string;
  reportId: string;
  agencyCode: AgencyCode;
  agencyName: string;
  priority: 'normal' | 'tinggi' | 'darurat';
  dispatchStatus: 'terkirim' | 'diterima_instansi' | 'ditindaklanjuti' | 'selesai';
  referenceNumber: string;
  payloadSummary: string;
  rwCode: 'RW013';
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}
