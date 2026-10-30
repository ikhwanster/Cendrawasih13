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
  ArrowLeft,
  BarChart3,
  Bell,
  BellRing,
  Camera,
  CheckCircle2,
  ChevronRight,
  CloudRain,
  Construction,
  Droplets,
  Globe,
  Grid2x2,
  Home,
  Image as ImageIcon,
  LayoutGrid,
  Lightbulb,
  Loader2,
  LogIn,
  LogOut,
  Map as MapIcon,
  MapPin,
  Maximize2,
  Minimize2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
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
  overview: 'SiagaWarga',
  per_rt: 'Data RT',
  create_report: 'Lapor',
  jumantik: 'Jentik',
  analytics: 'Tren',
  admin: 'Admin',
  api_gateway: 'API',
};

const CATEGORY_CIRCLE_ICONS: Array<{
  id: ReportCategory;
  short: string;
  icon: React.ReactNode;
}> = [
  {
    id: 'kesehatan_jentik',
    short: 'Jentik',
    icon: <Droplets className="w-4 h-4" />,
  },
  {
    id: 'drainase_banjir',
    short: 'Banjir',
    icon: <CloudRain className="w-4 h-4" />,
  },
  {
    id: 'infrastruktur',
    short: 'Jalan',
    icon: <Construction className="w-4 h-4" />,
  },
  {
    id: 'kebersihan',
    short: 'Sampah',
    icon: <Trash2 className="w-4 h-4" />,
  },
  {
    id: 'keamanan',
    short: 'Aman',
    icon: <ShieldAlert className="w-4 h-4" />,
  },
  {
    id: 'fasilitas_umum',
    short: 'PJU',
    icon: <Lightbulb className="w-4 h-4" />,
  },
];

export default function App() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState('');
  const [welcomeStep, setWelcomeStep] = useState<'splash' | 'signin'>('splash');

  const [userProfile, setUserProfile] = useState<UserPublicProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [profileReady, setProfileReady] = useState(false);

  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [frameExpanded, setFrameExpanded] = useState(false);
  const [menuSheetOpen, setMenuSheetOpen] = useState(false);
  const [notifDrawerOpen, setNotifDrawerOpen] = useState(false);

  // Real-time Collections State
  const [publicReports, setPublicReports] = useState<CitizenReport[]>([]);
  const [ownReports, setOwnReports] = useState<CitizenReport[]>([]);
  const [jumantikLogs, setJumantikLogs] = useState<JumantikLog[]>([]);
  const [notifications, setNotifications] = useState<PushNotificationItem[]>([]);
  const [dispatches, setDispatches] = useState<AgencyDispatchItem[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Overview Hero Carousel, Map & Filter States
  const [heroSlide, setHeroSlide] = useState<number>(0);
  const [showOverviewMap, setShowOverviewMap] = useState<boolean>(true);
  const [feedScope, setFeedScope] = useState<'all' | 'mine'>('all');
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
      if (feedCategory !== 'ALL' && r.category !== feedCategory) return false;
      return true;
    });
  }, [allVisibleReports, feedScope, feedCategory, authUser?.uid]);

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

  // Loading Screen inside Centered Phone Frame
  if (authLoading) {
    return (
      <div className="h-dvh overflow-hidden bg-[#e2e8da] flex items-center justify-center sm:p-4">
        <div className="w-full max-w-[420px] h-full sm:max-h-[856px] bg-[#a5cf4c] sm:rounded-[42px] sm:border-[7px] sm:border-[#263015] sm:shadow-2xl flex flex-col items-center justify-center p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-[#586826] text-[#dcecc3] flex items-center justify-center">
            <Loader2 className="w-7 h-7 animate-spin" />
          </div>
          <p className="text-sm font-bold text-[#263015]">SiagaWarga RW 013</p>
          <p className="text-xs text-[#3f4d1b]">Menyiapkan aplikasi pelaporan warga...</p>
        </div>
      </div>
    );
  }

  // Unauthenticated Flow: Reference Screen 1 (Matcha Splash) -> Reference Screen 2 (Clean Off-White Sign-In)
  if (!authUser || !userProfile) {
    return (
      <div className="h-dvh overflow-hidden bg-[#e2e8da] flex flex-col items-center justify-center sm:p-4">
        <div
          className={`w-full max-w-[420px] h-full sm:max-h-[856px] sm:rounded-[42px] sm:border-[7px] sm:border-[#263015] sm:shadow-2xl overflow-y-auto phone-scroll flex flex-col justify-between transition-colors duration-200 ${
            welcomeStep === 'splash' ? 'bg-[#a5cf4c]' : 'bg-[#f7f9f4]'
          }`}
        >
          {welcomeStep === 'splash' ? (
            /* Reference Screen 1: Vibrant Matcha Splash Screen */
            <div className="flex-1 flex flex-col justify-between p-7 text-center">
              <div className="pt-1 space-y-2">
                <div className="w-16 h-1 rounded-full bg-white/75 mx-auto" />
                <div className="flex items-center justify-between text-[11px] font-mono text-[#3f4d1b] pt-1">
                  <span>RW 013</span>
                  <span>10 RT · LIVE GPS</span>
                </div>
              </div>

              {/* Centered Olive Emblem + Brand Title & Slogan */}
              <div className="my-auto py-8 flex flex-col items-center space-y-4">
                <div className="w-24 h-24 rounded-3xl bg-[#586826] text-[#a5cf4c] flex items-center justify-center shadow-md">
                  <ShieldCheck className="w-12 h-12 stroke-[2.2]" />
                </div>

                <div className="space-y-1">
                  <h1 className="text-2xl font-bold tracking-tight text-[#263015]">
                    SiagaWarga RW 013
                  </h1>
                  <p className="text-xs font-medium text-[#3f4d1b]">
                    Pelaporan Warga &amp; Kampung Bebas Jentik
                  </p>
                </div>

                <p className="text-xs text-[#263015]/85 max-w-[270px] leading-relaxed">
                  Kirim foto kejadian real-time, kunci titik GPS otomatis, pantau status via push, dan kelola 10 RT terpadu.
                </p>
              </div>

              {/* Two Stacked Full-Width Olive Pill Buttons at Bottom */}
              <div className="space-y-3 pb-1">
                <button
                  type="button"
                  onClick={() => setWelcomeStep('signin')}
                  className="w-full min-h-[48px] px-6 py-3 text-sm font-semibold text-[#f7f9f4] bg-[#586826] rounded-full hover:bg-[#48561e] active:scale-[0.98] transition-all cursor-pointer"
                >
                  Masuk Aplikasi
                </button>

                <a
                  href="/assets/aistudio/ABJ_RW_013___Kampung_Bebas_Jentik_374cf83d.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full min-h-[46px] px-6 py-3 text-xs font-semibold text-[#dcecc3] bg-[#48561e] rounded-full hover:bg-[#3b4718] active:scale-[0.98] transition-all flex items-center justify-center"
                >
                  Lihat Pedoman ABJ RW 013
                </a>

                <div className="pt-2">
                  <div className="w-28 h-1 rounded-full bg-[#586826]/65 mx-auto" />
                </div>
              </div>
            </div>
          ) : (
            /* Reference Screen 2: Crisp Off-White Sign-In Screen */
            <div className="flex-1 flex flex-col justify-between p-7">
              <div className="space-y-3">
                <div className="w-16 h-1 rounded-full bg-[#cbe0b0] mx-auto" />
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setWelcomeStep('splash')}
                    className="min-h-[40px] inline-flex items-center gap-1.5 text-xs font-semibold text-[#586826] hover:text-[#263015] cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Kembali</span>
                  </button>
                  <span className="text-[11px] font-mono text-[#5b6649]">RW 013 · 10 RT</span>
                </div>
              </div>

              {/* Centered Clean Sign-In Block (Reference Screen 2) */}
              <div className="my-auto py-6 space-y-5 text-center">
                <div className="space-y-1.5">
                  <h2 className="text-2xl font-bold text-[#586826] tracking-tight">
                    Masuk Warga
                  </h2>
                  <p className="text-xs text-[#5b6649]">
                    Akses terverifikasi warga, kader Jumantik, &amp; pengurus RW 013
                  </p>
                </div>

                {/* Soft Tinted Pill Bars Inspired by Screen 2 */}
                <div className="space-y-3 text-left">
                  <div className="bg-[#e6f2d3]/85 border border-[#cbe0b0] rounded-full px-4 py-3 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#263015]">Lingkungan RW 013</span>
                      <span className="font-mono text-[11px] text-[#586826]">RT 001 – RT 010</span>
                    </div>
                    <div className="w-2/3 h-1 rounded-full bg-[#586826]" />
                  </div>

                  <div className="bg-[#e6f2d3]/85 border border-[#cbe0b0] rounded-full px-4 py-3 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#263015]">Identitas Terlindungi</span>
                      <span className="font-mono text-[11px] text-[#586826]">Google OAuth</span>
                    </div>
                    <div className="w-1/2 h-1 rounded-full bg-[#a5cf4c]" />
                  </div>
                </div>

                {/* Compact Centered Olive Pill CTA */}
                <div>
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={signingIn}
                    className="min-h-[42px] inline-flex items-center justify-center gap-2 px-7 py-2 text-xs font-semibold text-[#f7f9f4] bg-[#586826] rounded-full hover:bg-[#48561e] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50"
                  >
                    {signingIn ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <LogIn className="w-3.5 h-3.5" />
                    )}
                    <span>Log In Google</span>
                  </button>
                </div>

                {authError && (
                  <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-800 text-left">
                    {authError}
                  </div>
                )}
              </div>

              {/* Bottom Full-Width Primary Olive Button & Subtle Feature Lines */}
              <div className="space-y-4">
                <div className="flex items-center justify-end gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#586826]" />
                  <span className="w-12 h-1.5 rounded-full bg-[#a5cf4c]" />
                </div>

                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={signingIn}
                  className="w-full min-h-[48px] inline-flex items-center justify-center gap-2.5 px-6 py-3 text-sm font-semibold text-[#f7f9f4] bg-[#586826] rounded-full hover:bg-[#48561e] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50"
                >
                  {signingIn ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <LogIn className="w-4 h-4" />
                  )}
                  <span>Masuk dengan Akun Google</span>
                </button>

                <div className="space-y-1 text-center text-[11px] text-[#5b6649]">
                  <p>Foto Kejadian Real-Time · GPS Presisi · Push Status</p>
                  <p className="text-[#586826] font-medium">
                    Rekap 10 RT · Surveilans ABJ · API Instansi
                  </p>
                </div>

                <div className="pt-1">
                  <div className="w-28 h-1 rounded-full bg-[#586826]/65 mx-auto" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const openReportCount = allVisibleReports.filter(
    (r) => r.status !== 'selesai' && r.status !== 'ditolak'
  ).length;
  const completedReportCount = allVisibleReports.filter((r) => r.status === 'selesai').length;

  // Alternate screen background between Crisp Warm Off-White (#f7f9f4) and Soft Sage (#dcecc3) like the Reference Kit
  const isSageScreen =
    activeTab === 'create_report' || activeTab === 'jumantik' || activeTab === 'admin';

  const heroCarouselSlides = [
    {
      id: 'slide-live',
      kicker: 'PANTAUAN LINGKUNGAN RW 013',
      title: `${allVisibleReports.length} Laporan Warga Real-Time`,
      subtitle: `${openReportCount} sedang ditangani · ${completedReportCount} selesai diverifikasi`,
      actionLabel: showOverviewMap ? 'Sembunyikan Peta' : 'Tampilkan Peta GPS',
      onAction: () => setShowOverviewMap((v) => !v),
      icon: <MapIcon className="w-8 h-8 text-[#a5cf4c]" />,
    },
    {
      id: 'slide-abj',
      kicker: 'KAMPUNG BEBAS JENTIK',
      title: `Capaian ABJ ${cumulativeAbj === null ? 'Belum Cek' : `${cumulativeAbj}%`}`,
      subtitle: 'Standar baku Kemenkes RI ≥ 95,0% di 10 wilayah RT',
      actionLabel: 'Buka Modul Jumantik',
      onAction: () => setActiveTab('jumantik'),
      icon: <Droplets className="w-8 h-8 text-[#a5cf4c]" />,
    },
    {
      id: 'slide-10rt',
      kicker: 'KATALOG WILAYAH TERPADU',
      title: 'Mode Laporan 10 RT',
      subtitle: 'Rekapitulasi, peta kejadian, & unduh CSV RT 001 – RT 010',
      actionLabel: 'Buka Grid 10 RT',
      onAction: () => setActiveTab('per_rt'),
      icon: <Grid2x2 className="w-8 h-8 text-[#a5cf4c]" />,
    },
    {
      id: 'slide-trend',
      kicker: 'PEMETAAN KERAWANAN & API',
      title: 'Analisis Jam & Zona Rawan',
      subtitle: 'Deteksi titik prioritas intervensi & gateway API dinas',
      actionLabel: 'Lihat Analisis Rawan',
      onAction: () => setActiveTab('analytics'),
      icon: <BarChart3 className="w-8 h-8 text-[#a5cf4c]" />,
    },
  ];

  const currentHero = heroCarouselSlides[heroSlide] || heroCarouselSlides[0];

  const extraModules: Array<{
    id: NavTab;
    label: string;
    icon: React.ReactNode;
    badge?: string;
  }> = [
    {
      id: 'analytics',
      label: 'Tren',
      icon: <BarChart3 className="w-5 h-5" />,
    },
    ...(isAdmin
      ? [
          {
            id: 'admin' as NavTab,
            label: 'Admin',
            icon: <ShieldCheck className="w-5 h-5" />,
            badge: openReportCount > 0 ? String(openReportCount) : undefined,
          },
        ]
      : []),
    {
      id: 'api_gateway',
      label: 'API',
      icon: <Globe className="w-5 h-5" />,
    },
  ];

  const isSecondaryScreen =
    activeTab === 'analytics' || activeTab === 'admin' || activeTab === 'api_gateway';

  return (
    <div className="h-dvh overflow-hidden bg-[#e2e8da] flex flex-col items-center justify-center sm:py-3 sm:px-4">
      {/* Subtle Outer Studio Frame Control (Desktop Only) */}
      <div
        className={`hidden sm:flex items-center justify-between w-full shrink-0 mb-2 px-3 text-xs text-[#5b6649] transition-all ${
          frameExpanded ? 'max-w-4xl' : 'max-w-[420px]'
        }`}
      >
        <span className="font-semibold text-[#263015]">
          SiagaWarga RW 013 · {userProfile.rt}
        </span>
        <button
          type="button"
          onClick={() => setFrameExpanded((prev) => !prev)}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/80 border border-[#cbe0b0] text-[11px] font-semibold text-[#586826] hover:bg-white cursor-pointer"
        >
          {frameExpanded ? (
            <>
              <Minimize2 className="w-3 h-3" />
              <span>Bingkai Ponsel</span>
            </>
          ) : (
            <>
              <Maximize2 className="w-3 h-3" />
              <span>Perluas</span>
            </>
          )}
        </button>
      </div>

      {/* Centered Mobile-App Phone Frame Shell (Viewport-Constrained so Top & Bottom Menus Stay Sticky) */}
      <div
        className={`w-full flex-1 min-h-0 ${
          frameExpanded ? 'sm:max-w-4xl sm:max-h-[880px]' : 'sm:max-w-[420px] sm:max-h-[856px]'
        } sm:rounded-[42px] sm:border-[7px] sm:border-[#263015] sm:shadow-2xl overflow-hidden flex flex-col relative transition-all duration-200 ${
          isSageScreen ? 'bg-[#dcecc3]' : 'bg-[#f7f9f4]'
        }`}
      >
        {/* Sticky Top App Bar (50px — Clean Title & Single Notification Action) */}
        <header
          className={`sticky top-0 z-30 h-[50px] shrink-0 px-4 flex items-center justify-between gap-3 border-b shadow-[0_1px_4px_rgba(38,48,21,0.05)] ${
            isSageScreen
              ? 'bg-[#dcecc3]/95 border-[#cbe0b0]'
              : 'bg-[#f7f9f4]/95 border-[#cbe0b0]'
          } backdrop-blur-md`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {isSecondaryScreen ? (
              <button
                type="button"
                onClick={() => setActiveTab('overview')}
                aria-label="Kembali ke Beranda"
                className="min-h-[38px] min-w-[38px] -ml-1 rounded-full bg-[#586826]/10 text-[#263015] hover:bg-[#586826]/20 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            ) : (
              <span className="w-7 h-7 rounded-xl bg-[#586826] text-[#a5cf4c] flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </span>
            )}
            <span className="text-sm font-bold text-[#263015] truncate">
              {TAB_LABELS[activeTab]}
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              setMenuSheetOpen(false);
              setNotifDrawerOpen(true);
            }}
            aria-label="Buka notifikasi"
            className="min-h-[40px] min-w-[40px] rounded-full bg-[#586826] text-[#f7f9f4] hover:bg-[#48561e] flex items-center justify-center relative transition-colors cursor-pointer shrink-0"
          >
            <Bell className="w-4 h-4" />
            {unreadNotifCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#a5cf4c] text-[#263015] font-mono text-[10px] font-bold flex items-center justify-center border border-[#263015]">
                {unreadNotifCount}
              </span>
            )}
          </button>
        </header>

        {/* Real-Time Push Notification Toast Banner Inside Frame */}
        {livePushToast && (
          <div className="bg-[#263015] text-[#f7f9f4] px-4 py-2.5 flex items-center justify-between gap-3 text-xs shrink-0 z-20">
            <div className="flex items-center gap-2 min-w-0">
              <BellRing className="w-4 h-4 text-[#a5cf4c] shrink-0" />
              <p className="truncate">
                <strong className="text-[#a5cf4c]">
                  {STATUS_LABELS[livePushToast.newStatus]}:
                </strong>{' '}
                {livePushToast.reportTitle}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setNotifDrawerOpen(true);
                  setLivePushToast(null);
                }}
                className="underline font-semibold text-[#dcecc3] whitespace-nowrap cursor-pointer"
              >
                Buka
              </button>
              <button
                type="button"
                onClick={() => setLivePushToast(null)}
                aria-label="Tutup banner notifikasi"
                className="text-[#dcecc3] hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Scrollable Screen Body (min-h-0 keeps header & bottom menu permanently sticky) */}
        <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain phone-scroll px-4 py-4">
          {activeTab === 'overview' && (
            <div className="space-y-5">
              {/* Simple 2-Item Scope Filter + RT Badge */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 p-1 bg-[#e6f2d3] border border-[#cbe0b0] rounded-full">
                  {(
                    [
                      { id: 'all', label: 'Semua' },
                      { id: 'mine', label: 'Saya' },
                    ] as const
                  ).map((sc) => (
                    <button
                      key={sc.id}
                      type="button"
                      onClick={() => setFeedScope(sc.id)}
                      className={`min-h-[34px] px-3.5 py-1 text-xs font-semibold rounded-full transition-colors whitespace-nowrap cursor-pointer ${
                        feedScope === sc.id
                          ? 'bg-[#586826] text-[#f7f9f4]'
                          : 'text-[#5b6649] hover:text-[#263015]'
                      }`}
                    >
                      {sc.label}
                    </button>
                  ))}
                </div>

                {browserPushPerm === 'default' ? (
                  <button
                    type="button"
                    onClick={handleRequestBrowserPush}
                    className="min-h-[36px] inline-flex items-center gap-1 px-3 py-1 text-[11px] font-semibold text-[#263015] bg-[#a5cf4c] rounded-full hover:opacity-95 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <BellRing className="w-3 h-3" />
                    <span>Push</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setMenuSheetOpen(true)}
                    className="min-h-[36px] px-3 py-1 text-[11px] font-mono font-semibold text-[#586826] bg-[#e6f2d3] border border-[#cbe0b0] rounded-full whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {userProfile.rt}
                  </button>
                )}
              </div>

              {/* Reference Screens 3 & 4 Motif: Featured Square/Rounded Olive Card Carousel + Pagination Dots */}
              <section aria-label="Sorotan Utama RW 013" className="space-y-2.5">
                <div className="bg-[#586826] text-[#f7f9f4] rounded-3xl p-5 flex items-center justify-between gap-4 shadow-xs">
                  <div className="space-y-2 min-w-0">
                    <p className="text-[10px] font-mono tracking-wide text-[#a5cf4c]">
                      {currentHero.kicker}
                    </p>
                    <h2 className="text-lg font-bold leading-snug [text-wrap:balance]">
                      {currentHero.title}
                    </h2>
                    <p className="text-xs text-[#dcecc3]/90 leading-relaxed">
                      {currentHero.subtitle}
                    </p>
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={currentHero.onAction}
                        className="min-h-[38px] inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-[#263015] bg-[#a5cf4c] rounded-full hover:opacity-95 active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap"
                      >
                        <span>{currentHero.actionLabel}</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Iconic Square Media Emblem inside Olive Card */}
                  <div className="w-20 h-20 rounded-2xl bg-[#48561e] border-2 border-[#dcecc3]/35 flex items-center justify-center shrink-0">
                    {currentHero.icon}
                  </div>
                </div>

                {/* Pagination Dots (• ◦ ◦ ◦) matching Reference Screens 3 & 4 */}
                <div className="flex items-center justify-center gap-2">
                  {heroCarouselSlides.map((sl, idx) => (
                    <button
                      key={sl.id}
                      type="button"
                      onClick={() => setHeroSlide(idx)}
                      aria-label={`Sorotan ${idx + 1}`}
                      className={`h-2 rounded-full transition-all cursor-pointer ${
                        heroSlide === idx ? 'w-5 bg-[#586826]' : 'w-2 bg-[#cbe0b0]'
                      }`}
                    />
                  ))}
                </div>
              </section>

              {/* Reference Screen 5 Motif: 6 Circular Olive Category Filter Icons */}
              <section aria-label="Filter Cepat 6 Kategori" className="space-y-2">
                <div className="flex items-center justify-between px-0.5">
                  <span className="text-xs font-bold text-[#263015]">Kategori Laporan</span>
                  {feedCategory !== 'ALL' && (
                    <button
                      type="button"
                      onClick={() => setFeedCategory('ALL')}
                      className="text-[11px] font-semibold text-[#586826] underline cursor-pointer"
                    >
                      Tampilkan Semua
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-6 gap-1.5">
                  {CATEGORY_CIRCLE_ICONS.map((cat) => {
                    const active = feedCategory === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() =>
                          setFeedCategory((prev) => (prev === cat.id ? 'ALL' : cat.id))
                        }
                        className="flex flex-col items-center gap-1 py-1 cursor-pointer group"
                      >
                        <span
                          className={`w-11 h-11 rounded-full flex items-center justify-center transition-all active:scale-95 ${
                            active
                              ? 'bg-[#586826] text-[#a5cf4c] ring-2 ring-[#586826]/30'
                              : 'bg-[#dcecc3] text-[#586826] group-hover:bg-[#cbe0b0]'
                          }`}
                        >
                          {cat.icon}
                        </span>
                        <span
                          className={`text-[10px] font-medium truncate max-w-full ${
                            active ? 'text-[#263015] font-bold' : 'text-[#5b6649]'
                          }`}
                        >
                          {cat.short}
                        </span>
                        <span
                          className={`h-0.5 w-4 rounded-full ${
                            active ? 'bg-[#586826]' : 'bg-transparent'
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Live Geographic Map Card */}
              {showOverviewMap && (
                <section className="bg-[#dcecc3] border border-[#cbe0b0] rounded-3xl p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 px-0.5">
                    <div>
                      <h2 className="text-xs font-bold text-[#263015]">
                        Peta Geografis Kejadian &amp; Zona Rawan
                      </h2>
                      <p className="text-[11px] text-[#5b6649]">
                        Ketuk pin untuk bukti foto &amp; status penanganan
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowOverviewMap(false)}
                      className="text-[11px] font-semibold text-[#586826] hover:underline shrink-0 cursor-pointer"
                    >
                      Tutup Peta
                    </button>
                  </div>

                  <InteractiveMap
                    center={
                      overviewReports[0]
                        ? {
                            lat: overviewReports[0].latitude,
                            lng: overviewReports[0].longitude,
                          }
                        : DEFAULT_RW013_CENTER
                    }
                    zoom={15}
                    heightClass="h-52"
                    mode="explorer"
                    reports={overviewReports}
                    hotspots={hotspots}
                    showHotspots={true}
                    onSelectReport={(rep) => setActiveReportModal(rep)}
                  />
                </section>
              )}

              {/* Reference Screens 4, 5 & 6 Motif: Horizontal Report Cards with Square Olive Thumbnails */}
              <section className="space-y-3">
                <div className="flex items-center justify-between px-0.5">
                  <h2 className="text-sm font-bold text-[#263015]">
                    Daftar Laporan Warga ({overviewReports.length})
                  </h2>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('admin')}
                      className="text-xs font-semibold text-[#586826] hover:underline cursor-pointer"
                    >
                      Triase Admin →
                    </button>
                  )}
                </div>

                {dataLoading ? (
                  <div className="space-y-2.5">
                    {[1, 2, 3].map((n) => (
                      <div
                        key={n}
                        className="h-24 bg-white border border-[#cbe0b0] rounded-2xl p-3 animate-pulse flex items-center gap-3"
                      >
                        <div className="w-16 h-16 rounded-xl bg-[#dcecc3] shrink-0" />
                        <div className="flex-1 space-y-2">
                          <div className="h-3 w-1/2 bg-[#e6f2d3] rounded" />
                          <div className="h-3.5 w-3/4 bg-[#dcecc3] rounded" />
                          <div className="h-2.5 w-2/3 bg-[#e6f2d3] rounded" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : overviewReports.length === 0 ? (
                  <div className="bg-white border border-[#cbe0b0] rounded-3xl p-7 text-center space-y-3">
                    <div className="w-14 h-14 rounded-2xl bg-[#586826] text-[#dcecc3] flex items-center justify-center mx-auto">
                      <Camera className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-bold text-[#263015]">
                      Belum ada laporan pada filter ini
                    </p>
                    <p className="text-xs text-[#5b6649] leading-relaxed">
                      Kirimkan foto kejadian di sekitar Anda beserta lokasi GPS otomatis agar segera ditindaklanjuti pengurus RW 013.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setReportPrefill(null);
                        setActiveTab('create_report');
                      }}
                      className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-[#f7f9f4] bg-[#586826] rounded-full hover:bg-[#48561e] active:scale-[0.98] transition-all cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                      <span>Kirim Laporan Pertama</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {overviewReports.map((rep, idx) => {
                      const catMeta = CATEGORY_CATALOG[rep.category];
                      const sageTint = idx % 2 === 1;
                      return (
                        <article
                          key={rep.id}
                          onClick={() => setActiveReportModal(rep)}
                          className={`rounded-2xl p-3 border border-[#cbe0b0] transition-all active:scale-[0.99] cursor-pointer flex items-center gap-3 ${
                            sageTint
                              ? 'bg-[#e6f2d3] hover:bg-[#dcecc3]'
                              : 'bg-white hover:bg-[#e6f2d3]/60'
                          }`}
                        >
                          {/* Square Deep Olive Thumbnail on Left (Reference Screen 4/5/6) */}
                          <div className="w-16 h-16 rounded-2xl bg-[#586826] text-[#dcecc3] overflow-hidden shrink-0 flex items-center justify-center border border-[#48561e]">
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

                          {/* Stacked Clean Unboxed Metadata & Title */}
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center gap-1.5 text-[11px] text-[#5b6649] truncate">
                              <span className="font-semibold text-[#586826]">
                                {catMeta?.shortLabel || rep.category}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono font-semibold text-[#263015]">
                                {rep.rt}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span
                                className={
                                  rep.urgency === 'darurat'
                                    ? 'text-red-700 font-bold'
                                    : rep.urgency === 'tinggi'
                                    ? 'text-amber-800 font-semibold'
                                    : ''
                                }
                              >
                                {URGENCY_LABELS[rep.urgency]}
                              </span>
                            </div>

                            <h3 className="text-xs font-bold text-[#263015] truncate">
                              {rep.title}
                            </h3>

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

        {/* Sticky Bottom Navigation Menu Bar — 5 Clear 1-Word Menus */}
        <nav
          aria-label="Menu Utama"
          className="sticky bottom-0 z-40 h-[60px] shrink-0 bg-[#f7f9f4]/95 border-t border-[#cbe0b0] backdrop-blur-md grid grid-cols-5 items-center px-1.5 shadow-[0_-2px_10px_rgba(38,48,21,0.06)]"
        >
          <button
            type="button"
            onClick={() => {
              setMenuSheetOpen(false);
              setActiveTab('overview');
            }}
            className={`min-h-[48px] flex flex-col items-center justify-center rounded-2xl transition-colors cursor-pointer ${
              !menuSheetOpen && activeTab === 'overview'
                ? 'bg-[#e6f2d3] text-[#586826] font-bold'
                : 'text-[#5b6649] hover:text-[#263015]'
            }`}
          >
            <Home className="w-5 h-5" />
            <span className="text-[10px] mt-0.5 whitespace-nowrap">Beranda</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMenuSheetOpen(false);
              setActiveTab('per_rt');
            }}
            className={`min-h-[48px] flex flex-col items-center justify-center rounded-2xl transition-colors cursor-pointer ${
              !menuSheetOpen && activeTab === 'per_rt'
                ? 'bg-[#e6f2d3] text-[#586826] font-bold'
                : 'text-[#5b6649] hover:text-[#263015]'
            }`}
          >
            <Grid2x2 className="w-5 h-5" />
            <span className="text-[10px] mt-0.5 whitespace-nowrap">RT</span>
          </button>

          {/* Center Primary Report Button — Clearly Labeled "Lapor" */}
          <button
            type="button"
            onClick={() => {
              setMenuSheetOpen(false);
              setReportPrefill(null);
              setActiveTab('create_report');
            }}
            className="min-h-[48px] flex flex-col items-center justify-center cursor-pointer group"
          >
            <span
              className={`w-9 h-7 rounded-xl flex items-center justify-center transition-all group-active:scale-95 ${
                !menuSheetOpen && activeTab === 'create_report'
                  ? 'bg-[#a5cf4c] text-[#263015] ring-2 ring-[#586826]'
                  : 'bg-[#586826] text-[#f7f9f4] group-hover:bg-[#48561e]'
              }`}
            >
              <Camera className="w-4 h-4" />
            </span>
            <span
              className={`text-[10px] mt-0.5 whitespace-nowrap ${
                !menuSheetOpen && activeTab === 'create_report'
                  ? 'text-[#263015] font-bold'
                  : 'text-[#586826] font-semibold'
              }`}
            >
              Lapor
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMenuSheetOpen(false);
              setActiveTab('jumantik');
            }}
            className={`min-h-[48px] flex flex-col items-center justify-center rounded-2xl transition-colors cursor-pointer ${
              !menuSheetOpen && activeTab === 'jumantik'
                ? 'bg-[#e6f2d3] text-[#586826] font-bold'
                : 'text-[#5b6649] hover:text-[#263015]'
            }`}
          >
            <Droplets className="w-5 h-5" />
            <span className="text-[10px] mt-0.5 whitespace-nowrap">Jentik</span>
          </button>

          <button
            type="button"
            onClick={() => setMenuSheetOpen((prev) => !prev)}
            className={`min-h-[48px] flex flex-col items-center justify-center rounded-2xl transition-colors cursor-pointer relative ${
              menuSheetOpen || isSecondaryScreen
                ? 'bg-[#e6f2d3] text-[#586826] font-bold'
                : 'text-[#5b6649] hover:text-[#263015]'
            }`}
          >
            <LayoutGrid className="w-5 h-5" />
            <span className="text-[10px] mt-0.5 whitespace-nowrap">Lainnya</span>
          </button>
        </nav>

        {/* Compact "Lainnya" Sheet — Anchored Above Bottom Bar, Only Non-Repeated 1-Word Items + Account */}
        {menuSheetOpen && (
          <div
            onClick={() => setMenuSheetOpen(false)}
            className="absolute inset-x-0 top-0 bottom-[60px] z-35 flex items-end justify-center bg-black/35 backdrop-blur-xs"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full bg-[#f7f9f4] border-t border-[#cbe0b0] rounded-t-3xl p-4 space-y-3.5 shadow-xl"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#263015]">Menu Lainnya</span>
                <button
                  type="button"
                  onClick={() => setMenuSheetOpen(false)}
                  aria-label="Tutup menu lainnya"
                  className="min-h-[34px] min-w-[34px] rounded-full bg-[#e6f2d3] text-[#586826] flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Clean 1-Word Icon Tiles (Only Tren, Admin, API — Zero Duplication) */}
              <div className={`grid gap-2.5 ${isAdmin ? 'grid-cols-3' : 'grid-cols-2'}`}>
                {extraModules.map((mod) => {
                  const active = activeTab === mod.id;
                  return (
                    <button
                      key={mod.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(mod.id);
                        setMenuSheetOpen(false);
                      }}
                      className={`min-h-[76px] p-3 rounded-2xl border transition-all flex flex-col items-center justify-center gap-1.5 relative cursor-pointer ${
                        active
                          ? 'bg-[#586826] border-[#586826] text-[#f7f9f4]'
                          : 'bg-white border-[#cbe0b0] text-[#263015] hover:bg-[#e6f2d3]'
                      }`}
                    >
                      {mod.badge && (
                        <span className="absolute top-2 right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-[#a5cf4c] text-[#263015] font-mono text-[10px] font-bold flex items-center justify-center">
                          {mod.badge}
                        </span>
                      )}
                      <span className={active ? 'text-[#a5cf4c]' : 'text-[#586826]'}>
                        {mod.icon}
                      </span>
                      <span className="text-xs font-bold whitespace-nowrap">{mod.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Compact Account, Domisili RT & Sign-Out Strip */}
              <div className="bg-[#dcecc3] border border-[#cbe0b0] rounded-2xl p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#263015] truncate">
                    {userProfile.displayName}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <label htmlFor="sheet-home-rt" className="text-[11px] text-[#5b6649]">
                      Domisili:
                    </label>
                    <select
                      id="sheet-home-rt"
                      value={userProfile.rt}
                      onChange={(e) => handleChangeHomeRt(e.target.value as RtUnit)}
                      className="min-h-[30px] px-2.5 py-0.5 text-[11px] font-mono font-bold bg-white border border-[#cbe0b0] rounded-full text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
                    >
                      {RT_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setMenuSheetOpen(false);
                    signOut(auth);
                  }}
                  className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-red-800 bg-white border border-red-200 rounded-full hover:bg-red-50 transition-colors shrink-0 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Keluar</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Push Notification Bottom Sheet */}
        <NotificationDrawer
          open={notifDrawerOpen}
          onClose={() => setNotifDrawerOpen(false)}
          notifications={notifications}
          browserPermission={browserPushPerm}
          onRequestBrowserPermission={handleRequestBrowserPush}
        />

        {/* Full Report Detail Bottom Sheet / Modal */}
        <ReportDetailModal
          report={syncedModalReport}
          currentUserId={userProfile.uid}
          onClose={() => setActiveReportModal(null)}
        />
      </div>
    </div>
  );
}
