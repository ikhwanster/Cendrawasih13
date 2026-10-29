import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  Activity,
  BarChart3,
  Bell,
  BellRing,
  Camera,
  CheckCircle2,
  ClipboardList,
  Globe,
  Grid2x2,
  LayoutDashboard,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  Menu,
  Plus,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  auth,
  BOOTSTRAPPED_ADMIN_EMAIL,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from './firebase';
import {
  CATEGORY_CATALOG,
  RT_UNITS,
  STATUS_LABELS,
  URGENCY_LABELS,
  VALIDATION_LIMITS,
  type AgencyDispatchItem,
  type CitizenReport,
  type JumantikLog,
  type PushNotificationItem,
  type ReportCategory,
  type RtUnit,
  type UserPublicProfile,
} from './types';
import {
  computeRtVulnerability,
  DEFAULT_RW013_CENTER,
  formatTimestamp,
  timestampToMillis,
} from './utils/geoAndImage';
import { AdminDashboardView } from './components/AdminDashboardView';
import { ApiIntegrationView } from './components/ApiIntegrationView';
import {
  CreateReportPanel,
  type PrefillReportDraft,
} from './components/CreateReportPanel';
import { InteractiveMap } from './components/InteractiveMap';
import { JumantikModule } from './components/JumantikModule';
import { NotificationDrawer } from './components/NotificationDrawer';
import { ReportDetailModal } from './components/ReportDetailModal';
import { RtReportModeView } from './components/RtReportModeView';
import { TrendAnalyticsView } from './components/TrendAnalyticsView';

type NavTab =
  | 'overview'
  | 'per_rt'
  | 'create_report'
  | 'jumantik'
  | 'analytics'
  | 'admin'
  | 'api_gateway';

const TAB_LABELS: Record<NavTab, string> = {
  overview: 'Beranda & Peta Kejadian',
  per_rt: 'Mode Laporan Per RT (10 RT)',
  create_report: 'Kirim Laporan Warga',
  jumantik: 'Kampung Bebas Jentik',
  analytics: 'Analisis Area Rawan',
  admin: 'Dashboard Admin',
  api_gateway: 'Integrasi API Instansi',
};

export default function App() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState('');

  const [userProfile, setUserProfile] = useState<UserPublicProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [profileReady, setProfileReady] = useState(false);

  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [notifDrawerOpen, setNotifDrawerOpen] = useState(false);

  // Real-time Collections State
  const [publicReports, setPublicReports] = useState<CitizenReport[]>([]);
  const [ownReports, setOwnReports] = useState<CitizenReport[]>([]);
  const [jumantikLogs, setJumantikLogs] = useState<JumantikLog[]>([]);
  const [notifications, setNotifications] = useState<PushNotificationItem[]>([]);
  const [dispatches, setDispatches] = useState<AgencyDispatchItem[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Overview Filter & Modal States
  const [feedScope, setFeedScope] = useState<'all' | 'per_rt' | 'mine'>('all');
  const [overviewSelectedRt, setOverviewSelectedRt] = useState<RtUnit>('RT 001');
  const [feedCategory, setFeedCategory] = useState<'ALL' | ReportCategory>('ALL');
  const [activeReportModal, setActiveReportModal] = useState<CitizenReport | null>(null);
  const [reportPrefill, setReportPrefill] = useState<PrefillReportDraft | null>(null);

  // Push Notification Browser Permission & Real-Time Banner
  const [browserPushPerm, setBrowserPushPerm] = useState<
    NotificationPermission | 'unsupported'
  >(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    return Notification.permission;
  });
  const [livePushToast, setLivePushToast] = useState<PushNotificationItem | null>(null);
  const seenNotifIdsRef = useRef<Set<string>>(new Set());
  const initialNotifSnapshotDoneRef = useRef(false);

  // 1. Auth & Isolated Profile Initialization
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setAuthUser(u);
      setProfileReady(false);

      if (!u) {
        setUserProfile(null);
        setIsAdmin(false);
        setAuthLoading(false);
        return;
      }

      try {
        const userDocRef = doc(db, 'users', u.uid);
        const snap = await getDoc(userDocRef);

        if (!snap.exists()) {
          const safeName = (u.displayName || u.email?.split('@')[0] || 'Warga RW 013').slice(
            0,
            VALIDATION_LIMITS.DISPLAY_NAME_MAX
          );
          const newProfile = {
            uid: u.uid,
            displayName: safeName,
            rt: 'RT 001' as RtUnit,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          };
          await setDoc(userDocRef, newProfile);

          // Store PII strictly in isolated private subcollection
          if (u.email) {
            await setDoc(doc(db, 'users', u.uid, 'private', 'info'), {
              uid: u.uid,
              email: u.email.slice(0, 160),
              phone: '',
              updatedAt: serverTimestamp(),
            });
          }

          setUserProfile({
            uid: u.uid,
            displayName: safeName,
            rt: 'RT 001',
          });
        } else {
          const data = snap.data() as UserPublicProfile;
          const validRt = RT_UNITS.includes(data.rt) ? data.rt : 'RT 001';
          setUserProfile({
            uid: data.uid,
            displayName: data.displayName,
            rt: validRt,
          });
          setOverviewSelectedRt(validRt);
        }

        // Determine Admin RBAC status
        if (u.email === BOOTSTRAPPED_ADMIN_EMAIL && u.emailVerified) {
          setIsAdmin(true);
        } else {
          try {
            const adminSnap = await getDoc(doc(db, 'admins', u.uid));
            setIsAdmin(adminSnap.exists());
          } catch {
            setIsAdmin(false);
          }
        }

        setProfileReady(true);
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `users/${u.uid}`);
      } finally {
        setAuthLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // 2. Real-Time Firestore Subscriptions (Strictly Guarded by Verified Auth & Profile Readiness)
  useEffect(() => {
    if (!authUser || !authUser.emailVerified || !profileReady) {
      setPublicReports([]);
      setOwnReports([]);
      setJumantikLogs([]);
      setNotifications([]);
      setDispatches([]);
      setDataLoading(false);
      return;
    }

    setDataLoading(true);
    seenNotifIdsRef.current = new Set();
    initialNotifSnapshotDoneRef.current = false;

    const isBootstrapped = authUser.email === BOOTSTRAPPED_ADMIN_EMAIL;

    // A. Reports Subscriptions matching firestore.rules allow list
    const reportsQuery = isBootstrapped
      ? query(collection(db, 'reports'), where('rwCode', '==', 'RW013'))
      : query(
          collection(db, 'reports'),
          where('rwCode', '==', 'RW013'),
          where('visibility', '==', 'public')
        );

    const unsubPublicReports = onSnapshot(
      reportsQuery,
      (snap) => {
        const list: CitizenReport[] = snap.docs.map((d) => ({
          ...(d.data() as Omit<CitizenReport, 'id'>),
          id: d.id,
        }));
        setPublicReports(list);
        setDataLoading(false);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'reports')
    );

    const unsubOwnReports = isBootstrapped
      ? () => {}
      : onSnapshot(
          query(collection(db, 'reports'), where('authorId', '==', authUser.uid)),
          (snap) => {
            const list: CitizenReport[] = snap.docs.map((d) => ({
              ...(d.data() as Omit<CitizenReport, 'id'>),
              id: d.id,
            }));
            setOwnReports(list);
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'reports')
        );

    // B. Kampung Bebas Jentik RW 013 Logs
    const unsubJumantik = onSnapshot(
      query(collection(db, 'jumantikLogs'), where('rwCode', '==', 'RW013')),
      (snap) => {
        const list: JumantikLog[] = snap.docs.map((d) => ({
          ...(d.data() as Omit<JumantikLog, 'id'>),
          id: d.id,
        }));
        setJumantikLogs(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'jumantikLogs')
    );

    // C. Real-Time Push Notifications
    const unsubNotifs = onSnapshot(
      query(collection(db, 'notifications'), where('recipientId', '==', authUser.uid)),
      (snap) => {
        const list: PushNotificationItem[] = snap.docs
          .map((d) => ({
            ...(d.data() as Omit<PushNotificationItem, 'id'>),
            id: d.id,
          }))
          .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));

        if (!initialNotifSnapshotDoneRef.current) {
          for (const item of list) {
            seenNotifIdsRef.current.add(item.id);
          }
          initialNotifSnapshotDoneRef.current = true;
        } else {
          for (const item of list) {
            if (!seenNotifIdsRef.current.has(item.id)) {
              seenNotifIdsRef.current.add(item.id);
              if (!item.read) {
                setLivePushToast(item);
                if (
                  typeof window !== 'undefined' &&
                  'Notification' in window &&
                  Notification.permission === 'granted'
                ) {
                  try {
                    new Notification(`Status Laporan: ${STATUS_LABELS[item.newStatus]}`, {
                      body: `${item.reportTitle} — ${item.message}`,
                    });
                  } catch {
                    // Browser notification suppressed in iframe
                  }
                }
              }
            }
          }
        }

        setNotifications(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
    );

    // D. Municipal API Dispatches
    const unsubDispatches = onSnapshot(
      query(collection(db, 'agencyDispatches'), where('rwCode', '==', 'RW013')),
      (snap) => {
        const list: AgencyDispatchItem[] = snap.docs
          .map((d) => ({
            ...(d.data() as Omit<AgencyDispatchItem, 'id'>),
            id: d.id,
          }))
          .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt));
        setDispatches(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'agencyDispatches')
    );

    return () => {
      unsubPublicReports();
      unsubOwnReports();
      unsubJumantik();
      unsubNotifs();
      unsubDispatches();
    };
  }, [authUser, profileReady]);

  // Merge & Sort Reports without duplicates
  const allVisibleReports = useMemo(() => {
    const map = new Map<string, CitizenReport>();
    for (const r of publicReports) map.set(r.id, r);
    for (const r of ownReports) map.set(r.id, r);
    return Array.from(map.values()).sort(
      (a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt)
    );
  }, [publicReports, ownReports]);

  const overviewReports = useMemo(() => {
    return allVisibleReports.filter((r) => {
      if (feedScope === 'mine' && r.authorId !== authUser?.uid) return false;
      if (feedScope === 'per_rt' && r.rt !== overviewSelectedRt) return false;
      if (feedCategory !== 'ALL' && r.category !== feedCategory) return false;
      return true;
    });
  }, [allVisibleReports, feedScope, overviewSelectedRt, feedCategory, authUser?.uid]);

  const hotspots = useMemo(
    () => computeRtVulnerability(allVisibleReports, jumantikLogs),
    [allVisibleReports, jumantikLogs]
  );

  // Sync activeReportModal with live updates
  const syncedModalReport = useMemo(() => {
    if (!activeReportModal) return null;
    return allVisibleReports.find((r) => r.id === activeReportModal.id) || null;
  }, [activeReportModal, allVisibleReports]);

  const unreadNotifCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  const cumulativeAbj = useMemo(() => {
    const inspected = jumantikLogs.reduce((s, l) => s + l.housesInspected, 0);
    const positive = jumantikLogs.reduce((s, l) => s + l.housesWithLarvae, 0);
    if (inspected === 0) return null;
    return Number((((inspected - positive) / inspected) * 100).toFixed(1));
  }, [jumantikLogs]);

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    setAuthError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : 'Gagal masuk dengan akun Google. Pastikan jendela popup tidak diblokir.'
      );
    } finally {
      setSigningIn(false);
    }
  };

  const handleRequestBrowserPush = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setBrowserPushPerm('unsupported');
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setBrowserPushPerm(result);
    } catch {
      setBrowserPushPerm('denied');
    }
  };

  const handleChangeHomeRt = async (newRt: RtUnit) => {
    if (!userProfile) return;
    setUserProfile({ ...userProfile, rt: newRt });
    try {
      await updateDoc(doc(db, 'users', userProfile.uid), {
        rt: newRt,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${userProfile.uid}`);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex items-center gap-2.5 text-sm font-medium text-slate-600">
          <Loader2 className="w-4 h-4 animate-spin text-slate-900" />
          <span>Menyiapkan Ruang Kerja SiagaWarga RW 013...</span>
        </div>
      </div>
    );
  }

  // Unauthenticated Civic Portal Landing
  if (!authUser || !userProfile) {
    return (
      <div className="min-h-screen bg-white text-slate-900 flex flex-col">
        {/* Strict 3-Zone Top Bar Contract */}
        <header className="flex items-center justify-between gap-8 px-6 lg:px-12 py-4 border-b border-slate-200">
          <a
            href="#beranda"
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            SiagaWarga RW 013
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a
              href="#fitur"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Pelaporan Real-Time
            </a>
            <a
              href="#jumantik"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Bebas Jentik
            </a>
            <a
              href="#analitik"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Peta Rawan
            </a>
            <a
              href="#api"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              API Instansi
            </a>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={signingIn}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              {signingIn ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <LogIn className="w-3.5 h-3.5" />
              )}
              <span>Masuk Warga / Petugas</span>
            </button>
          </div>
        </header>

        <main id="beranda" className="flex-1 max-w-6xl w-full mx-auto px-6 lg:px-8 py-14 space-y-16">
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            <div className="lg:col-span-7 flex flex-col justify-center space-y-6">
              <p className="text-xs font-medium text-slate-500">
                Sistem Pelaporan Terpadu Lingkungan RW 013 · 10 Wilayah RT (RT 001 – RT 010)
              </p>
              <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-slate-900 leading-tight [text-wrap:balance]">
                Laporkan kejadian sekitar secara real-time dengan foto & lokasi GPS presisi.
              </h1>
              <p className="text-base text-slate-600 leading-relaxed max-w-xl">
                Platform kolaborasi warga, kader Jumantik Kampung Bebas Jentik, pengurus RW 013, dan instansi pemerintah daerah untuk mempercepat penanganan infrastruktur, kebersihan, keamanan, hingga pencegahan DBD.
              </p>

              {authError && (
                <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 max-w-md">
                  {authError}
                </div>
              )}

              <div className="pt-1 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={signingIn}
                  className="inline-flex items-center gap-2.5 px-6 py-3 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  {signingIn ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <LogIn className="w-4 h-4" />
                  )}
                  <span>Masuk dengan Akun Google</span>
                </button>
                <a
                  href="/assets/aistudio/ABJ_RW_013___Kampung_Bebas_Jentik_374cf83d.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-slate-700 hover:text-slate-900 underline underline-offset-4 whitespace-nowrap"
                >
                  Lihat Pedoman ABJ RW 013
                </a>
              </div>
            </div>

            <div className="lg:col-span-5 bg-slate-50 border border-slate-200 rounded-xl p-6 flex flex-col justify-between space-y-6">
              <div className="space-y-2">
                <h2 className="text-base font-semibold text-slate-900">
                  Alur Tindak Lanjut Terverifikasi
                </h2>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Setiap laporan terhubung langsung ke pusat pemantauan pengurus RW dan antarmuka API instansi terkait.
                </p>
              </div>

              <div className="divide-y divide-slate-200 text-xs">
                <div className="py-3 flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-slate-900">01. Bukti Foto & Titik GPS Otomatis</p>
                    <p className="text-slate-500 mt-0.5">
                      Kamera langsung dengan kompresi cepat serta reverse-geocoding alamat jalan otomatis.
                    </p>
                  </div>
                  <span className="font-mono text-slate-400 shrink-0">&lt; 10 dtk</span>
                </div>
                <div className="py-3 flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-slate-900">02. Triase Kategori & Notifikasi Push</p>
                    <p className="text-slate-500 mt-0.5">
                      Pemberitahuan instan ke perangkat pelapor setiap kali status laporan diperbarui petugas.
                    </p>
                  </div>
                  <span className="font-mono text-slate-400 shrink-0">Real-time</span>
                </div>
                <div className="py-3 flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-slate-900">03. Mode Laporan 10 RT & Surveilans ABJ</p>
                    <p className="text-slate-500 mt-0.5">
                      Rekap otomatis per RT (RT 001–RT 010), Kampung Bebas Jentik, dan pemetaan zona risiko.
                    </p>
                  </div>
                  <span className="font-mono text-slate-400 shrink-0">10 RT</span>
                </div>
                <div className="py-3 flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-slate-900">04. Gateway API Instansi Terkait</p>
                    <p className="text-slate-500 mt-0.5">
                      Format Open311-ID, GeoJSON RFC 7946, dan Webhook HMAC-SHA256 untuk Puskesmas & Dinas.
                    </p>
                  </div>
                  <span className="font-mono text-slate-400 shrink-0">REST v1</span>
                </div>
              </div>
            </div>
          </section>

          <section
            id="fitur"
            className="grid grid-cols-1 md:grid-cols-4 gap-6 pt-8 border-t border-slate-200"
          >
            <div className="space-y-1.5">
              <p className="text-xs font-mono text-slate-500">01 · KATEGORISASI</p>
              <h3 className="text-sm font-semibold text-slate-900">6 Sektor Layanan Publik</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Kesehatan/Jentik, Drainase/Banjir, Infrastruktur Jalan, Kebersihan, Keamanan, dan Fasilitas PJU.
              </p>
            </div>
            <div id="jumantik" className="space-y-1.5">
              <p className="text-xs font-mono text-slate-500">02 · JUMANTIK RW 013</p>
              <h3 className="text-sm font-semibold text-slate-900">Rekap ABJ Otomatis</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Pencatatan pemeriksaan rumah per RT dan per minggu sesuai standar baku Kemenkes ≥ 95%.
              </p>
            </div>
            <div id="analitik" className="space-y-1.5">
              <p className="text-xs font-mono text-slate-500">03 · PEMETAAN SPASIAL</p>
              <h3 className="text-sm font-semibold text-slate-900">Deteksi Jam & Zona Rawan</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Analisis tren 14 hari, distribusi jam rawan kejadian, dan matriks prioritas intervensi RT.
              </p>
            </div>
            <div id="api" className="space-y-1.5">
              <p className="text-xs font-mono text-slate-500">04 · INTEROPERABILITAS</p>
              <h3 className="text-sm font-semibold text-slate-900">Akses API Instansi</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Endpoint GeoJSON & ringkasan surveilans yang siap dikonsumsi sistem GIS dinas terkait.
              </p>
            </div>
          </section>
        </main>

        <footer className="px-6 lg:px-12 py-6 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <span>SiagaWarga RW 013 · Sistem Pelaporan Warga & Kampung Bebas Jentik</span>
          <span>Data dilindungi kontrol akses terverifikasi & isolasi privasi warga</span>
        </footer>
      </div>
    );
  }

  // Authenticated SaaS Civic Workspace Layout
  const navItems: Array<{ id: NavTab; label: string; icon: React.ReactNode }> = [
    {
      id: 'overview',
      label: 'Beranda & Peta',
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      id: 'per_rt',
      label: 'Laporan Per RT (10 RT)',
      icon: <Grid2x2 className="w-4 h-4" />,
    },
    {
      id: 'create_report',
      label: 'Kirim Laporan',
      icon: <Camera className="w-4 h-4" />,
    },
    {
      id: 'jumantik',
      label: 'Bebas Jentik (ABJ)',
      icon: <ClipboardList className="w-4 h-4" />,
    },
    {
      id: 'analytics',
      label: 'Analisis Area Rawan',
      icon: <BarChart3 className="w-4 h-4" />,
    },
    ...(isAdmin
      ? [
          {
            id: 'admin' as NavTab,
            label: 'Dashboard Admin',
            icon: <ShieldCheck className="w-4 h-4" />,
          },
        ]
      : []),
    {
      id: 'api_gateway',
      label: 'API Instansi Terkait',
      icon: <Globe className="w-4 h-4" />,
    },
  ];

  const openReportCount = allVisibleReports.filter(
    (r) => r.status !== 'selesai' && r.status !== 'ditolak'
  ).length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Sidebar (256px) */}
      <aside className="hidden lg:flex lg:flex-col w-64 bg-white border-r border-slate-200 shrink-0 sticky top-0 h-screen">
        <div className="px-5 py-4 border-b border-slate-200">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap cursor-pointer"
          >
            SiagaWarga RW 013
          </button>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Pelaporan & Surveilans Lingkungan
          </p>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-slate-900 text-white font-semibold'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="inline-flex items-center gap-2.5">
                  {item.icon}
                  <span>{item.label}</span>
                </span>
                {item.id === 'admin' && openReportCount > 0 && (
                  <span
                    className={`font-mono text-[11px] ${
                      active ? 'text-slate-200' : 'text-slate-500'
                    }`}
                  >
                    {openReportCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Citizen Profile & Home RT Selector */}
        <div className="p-4 border-t border-slate-200 space-y-3 text-xs">
          <div className="space-y-1">
            <p className="font-semibold text-slate-900 truncate">{userProfile.displayName}</p>
            <p className="text-[11px] text-slate-500">
              {isAdmin ? 'Petugas Admin RW 013' : 'Warga Terverifikasi'}
            </p>
          </div>

          <div className="flex items-center justify-between gap-2">
            <label htmlFor="sidebar-rt" className="text-[11px] text-slate-500">
              Domisili:
            </label>
            <select
              id="sidebar-rt"
              value={userProfile.rt}
              onChange={(e) => handleChangeHomeRt(e.target.value as RtUnit)}
              className="px-2 py-1 text-xs font-mono bg-slate-50 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-slate-900"
            >
              {RT_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => signOut(auth)}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-red-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Keluar Sesi</span>
          </button>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex bg-slate-950/40">
          <div className="w-64 bg-white h-full border-r border-slate-200 flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <span className="text-base font-bold text-slate-900">SiagaWarga RW 013</span>
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(false)}
                className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileSidebarOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium rounded-lg ${
                    activeTab === item.id
                      ? 'bg-slate-900 text-white font-semibold'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>
            <div className="p-4 border-t border-slate-200">
              <button
                type="button"
                onClick={() => signOut(auth)}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 border border-slate-200 rounded-lg"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Keluar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* SaaS Top Bar Contract: Breadcrumb on Left, max 2 Primary Actions on Right */}
        <header className="bg-white border-b border-slate-200 px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Buka menu navigasi"
              className="lg:hidden p-1.5 text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-500 truncate">
              <span className="font-medium text-slate-700 hidden sm:inline">RW 013</span>
              <span aria-hidden="true" className="hidden sm:inline">
                /
              </span>
              <span className="font-semibold text-slate-900 truncate">
                {TAB_LABELS[activeTab]}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setNotifDrawerOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Bell className="w-3.5 h-3.5" />
              <span>Notifikasi</span>
              {unreadNotifCount > 0 && (
                <span className="font-mono font-bold text-red-700">({unreadNotifCount})</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setReportPrefill(null);
                setActiveTab('create_report');
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Lapor Kejadian</span>
            </button>
          </div>
        </header>

        {/* Real-Time Push Notification Toast Banner */}
        {livePushToast && (
          <div className="bg-slate-900 text-white px-4 sm:px-8 py-3 flex items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <BellRing className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="truncate">
                <strong>Pembaruan Status ({STATUS_LABELS[livePushToast.newStatus]}):</strong>{' '}
                {livePushToast.reportTitle} — {livePushToast.message}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setNotifDrawerOpen(true);
                  setLivePushToast(null);
                }}
                className="underline font-semibold whitespace-nowrap cursor-pointer"
              >
                Lihat
              </button>
              <button
                type="button"
                onClick={() => setLivePushToast(null)}
                className="text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Viewport Workspace Container */}
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-8 py-8">
          {activeTab === 'overview' && (
            <div className="space-y-8">
              {/* Overview Header */}
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-5">
                <div>
                  <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                    Pemantauan Real-Time Lingkungan RW 013
                  </h1>
                  <p className="text-sm text-slate-600 mt-1">
                    Pantau laporan warga sekitar, posisi geografis kejadian, dan capaian Kampung Bebas Jentik secara langsung.
                  </p>
                </div>

                {browserPushPerm === 'default' && (
                  <button
                    type="button"
                    onClick={handleRequestBrowserPush}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <BellRing className="w-3.5 h-3.5" />
                    <span>Aktifkan Push Browser</span>
                  </button>
                )}
              </div>

              {/* 4-Column Metric Strip */}
              <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
                  <p className="text-xs text-slate-500">Total Laporan Warga</p>
                  <p className="text-3xl font-bold font-mono tabular-nums text-slate-900">
                    {allVisibleReports.length}
                  </p>
                  <p className="text-xs text-slate-500">Tersinkronisasi otomatis</p>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
                  <p className="text-xs text-slate-500">Sedang Ditangani</p>
                  <p className="text-3xl font-bold font-mono tabular-nums text-amber-700">
                    {openReportCount}
                  </p>
                  <p className="text-xs text-slate-500">Menunggu / diproses instansi</p>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1">
                  <p className="text-xs text-slate-500">Laporan Selesai</p>
                  <p className="text-3xl font-bold font-mono tabular-nums text-emerald-700">
                    {allVisibleReports.filter((r) => r.status === 'selesai').length}
                  </p>
                  <p className="text-xs text-slate-500">Tuntas diverifikasi lapangan</p>
                </div>

                <div
                  onClick={() => setActiveTab('jumantik')}
                  className="bg-white border border-slate-200 rounded-xl p-5 space-y-1 hover:border-slate-400 transition-colors cursor-pointer"
                >
                  <p className="text-xs text-slate-500">ABJ Bebas Jentik RW 013</p>
                  <p
                    className={`text-3xl font-bold font-mono tabular-nums ${
                      cumulativeAbj === null
                        ? 'text-slate-900'
                        : cumulativeAbj >= 95
                        ? 'text-emerald-700'
                        : 'text-red-700'
                    }`}
                  >
                    {cumulativeAbj === null ? '–' : `${cumulativeAbj}%`}
                  </p>
                  <p className="text-xs text-slate-500 underline underline-offset-2">
                    Buka rekap Jumantik RT →
                  </p>
                </div>
              </section>

              {/* Live Geographic Map */}
              <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                      <Activity className="w-4 h-4 text-slate-700" />
                      <span>Peta Geografis Laporan & Zona Kerawanan</span>
                    </h2>
                    <p className="text-xs text-slate-500">
                      Klik pin pada peta untuk melihat bukti foto, alamat hasil GPS, dan status penanganan.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                      <button
                        type="button"
                        onClick={() => setFeedScope('all')}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                          feedScope === 'all'
                            ? 'bg-white text-slate-900 shadow-xs font-semibold'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Semua RW 013
                      </button>
                      <button
                        type="button"
                        onClick={() => setFeedScope('per_rt')}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                          feedScope === 'per_rt'
                            ? 'bg-white text-slate-900 shadow-xs font-semibold'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Per RT (10 RT)
                      </button>
                      <button
                        type="button"
                        onClick={() => setFeedScope('mine')}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                          feedScope === 'mine'
                            ? 'bg-white text-slate-900 shadow-xs font-semibold'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Laporan Saya
                      </button>
                    </div>

                    <select
                      aria-label="Filter Kategori Beranda"
                      value={feedCategory}
                      onChange={(e) => setFeedCategory(e.target.value as 'ALL' | ReportCategory)}
                      className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                    >
                      <option value="ALL">Semua Kategori</option>
                      {Object.values(CATEGORY_CATALOG).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.shortLabel}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {feedScope === 'per_rt' && (
                  <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {RT_UNITS.map((unit) => {
                        const count = allVisibleReports.filter((r) => r.rt === unit).length;
                        const active = overviewSelectedRt === unit;
                        return (
                          <button
                            key={unit}
                            type="button"
                            onClick={() => setOverviewSelectedRt(unit)}
                            className={`px-2.5 py-1 text-xs font-mono rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                              active
                                ? 'bg-slate-900 border-slate-900 text-white font-semibold'
                                : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            {unit} ({count})
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('per_rt')}
                      className="text-xs font-semibold text-slate-900 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Buka Matriks Lengkap 10 RT →
                    </button>
                  </div>
                )}

                <InteractiveMap
                  center={
                    overviewReports[0]
                      ? { lat: overviewReports[0].latitude, lng: overviewReports[0].longitude }
                      : DEFAULT_RW013_CENTER
                  }
                  zoom={15}
                  heightClass="h-96"
                  mode="explorer"
                  reports={overviewReports}
                  hotspots={hotspots}
                  showHotspots={true}
                  onSelectReport={(rep) => setActiveReportModal(rep)}
                />
              </section>

              {/* Real-Time Incident Feed */}
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-900">
                    Daftar Laporan Terbaru ({overviewReports.length})
                  </h2>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('admin')}
                      className="text-xs font-semibold text-slate-900 hover:underline cursor-pointer"
                    >
                      Kelola di Dashboard Admin →
                    </button>
                  )}
                </div>

                {dataLoading ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[1, 2, 3, 4].map((n) => (
                      <div
                        key={n}
                        className="h-40 bg-white border border-slate-200 rounded-xl p-5 animate-pulse space-y-3"
                      >
                        <div className="h-3 w-1/3 bg-slate-200 rounded" />
                        <div className="h-4 w-3/4 bg-slate-200 rounded" />
                        <div className="h-3 w-full bg-slate-100 rounded" />
                      </div>
                    ))}
                  </div>
                ) : overviewReports.length === 0 ? (
                  <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
                    <p className="text-sm font-semibold text-slate-900">
                      Belum ada laporan warga pada tampilan ini
                    </p>
                    <p className="text-xs text-slate-500 max-w-md mx-auto">
                      Kirimkan foto kejadian di sekitar Anda beserta titik lokasi GPS otomatis agar segera ditindaklanjuti oleh pengurus RW 013 dan instansi terkait.
                    </p>
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => setActiveTab('create_report')}
                        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        <span>Kirim Laporan Pertama</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {overviewReports.map((rep) => {
                      const catMeta = CATEGORY_CATALOG[rep.category];
                      return (
                        <article
                          key={rep.id}
                          onClick={() => setActiveReportModal(rep)}
                          className="bg-white border border-slate-200 rounded-xl overflow-hidden hover:border-slate-400 transition-colors cursor-pointer flex flex-col"
                        >
                          {rep.photoDataUrl ? (
                            <img
                              src={rep.photoDataUrl}
                              alt={rep.title}
                              referrerPolicy="no-referrer"
                              className="w-full h-44 object-cover border-b border-slate-100"
                            />
                          ) : null}
                          <div className="p-5 flex-1 flex flex-col justify-between space-y-3">
                            <div className="space-y-1.5">
                              {/* Zero-Pill Metadata Discipline: Clean unboxed text with separators */}
                              <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                                <span className="font-medium text-slate-800">
                                  {catMeta?.shortLabel || rep.category}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono">{rep.rt}</span>
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
                              </div>

                              <h3 className="text-base font-semibold text-slate-900 leading-snug">
                                {rep.title}
                              </h3>
                              <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                                {rep.description}
                              </p>
                            </div>

                            <div className="pt-3 border-t border-slate-100 space-y-1.5 text-xs">
                              <div className="flex items-center gap-1.5 text-slate-500 truncate">
                                <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                                <span className="truncate">{rep.address}</span>
                              </div>
                              <div className="flex items-center justify-between gap-2">
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
              </section>
            </div>
          )}

          {activeTab === 'per_rt' && (
            <RtReportModeView
              reports={allVisibleReports}
              jumantikLogs={jumantikLogs}
              initialRt={overviewSelectedRt}
              onSelectReport={(rep) => setActiveReportModal(rep)}
              onCreateReportForRt={(targetRt) => {
                setReportPrefill({ rt: targetRt });
                setActiveTab('create_report');
              }}
            />
          )}

          {activeTab === 'create_report' && (
            <CreateReportPanel
              userProfile={userProfile}
              prefill={reportPrefill}
              onSuccess={() => {
                setReportPrefill(null);
                setActiveTab('overview');
              }}
              onCancel={() => {
                setReportPrefill(null);
                setActiveTab('overview');
              }}
            />
          )}

          {activeTab === 'jumantik' && (
            <JumantikModule
              logs={jumantikLogs}
              userProfile={userProfile}
              isAdmin={isAdmin}
              onEscalateToReport={(draft) => {
                setReportPrefill(draft);
                setActiveTab('create_report');
              }}
            />
          )}

          {activeTab === 'analytics' && (
            <TrendAnalyticsView
              reports={allVisibleReports}
              jumantikLogs={jumantikLogs}
              onSelectReport={(rep) => setActiveReportModal(rep)}
            />
          )}

          {activeTab === 'admin' && isAdmin && (
            <AdminDashboardView
              reports={allVisibleReports}
              adminProfile={userProfile}
              isBootstrappedAdmin={authUser.email === BOOTSTRAPPED_ADMIN_EMAIL}
            />
          )}

          {activeTab === 'api_gateway' && <ApiIntegrationView dispatches={dispatches} />}
        </main>
      </div>

      {/* Slide-Over Push Notification Center */}
      <NotificationDrawer
        open={notifDrawerOpen}
        onClose={() => setNotifDrawerOpen(false)}
        notifications={notifications}
        browserPermission={browserPushPerm}
        onRequestBrowserPermission={handleRequestBrowserPush}
      />

      {/* Full Report Detail Modal */}
      <ReportDetailModal
        report={syncedModalReport}
        currentUserId={userProfile.uid}
        onClose={() => setActiveReportModal(null)}
      />
    </div>
  );
}
