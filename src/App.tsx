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
  ClipboardList,
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
  Menu,
  Minimize2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
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
  overview: 'SiagaWarga RW 013',
  per_rt: 'Mode 10 Wilayah RT',
  create_report: 'Kirim Laporan Warga',
  jumantik: 'Bebas Jentik (ABJ)',
  analytics: 'Analisis Area Rawan',
  admin: 'Dashboard Admin',
  api_gateway: 'Gateway API Instansi',
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

  // Loading Screen inside Centered Phone Frame
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#e2e8da] flex items-center justify-center sm:p-6">
        <div className="w-full max-w-[420px] min-h-screen sm:min-h-[820px] bg-[#a5cf4c] sm:rounded-[42px] sm:border-[7px] sm:border-[#263015] sm:shadow-2xl flex flex-col items-center justify-center p-8 text-center space-y-4">
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
      <div className="min-h-screen bg-[#e2e8da] flex flex-col items-center justify-center sm:p-6">
        <div
          className={`w-full max-w-[420px] min-h-screen sm:min-h-[830px] sm:max-h-[880px] sm:rounded-[42px] sm:border-[7px] sm:border-[#263015] sm:shadow-2xl overflow-hidden flex flex-col justify-between transition-colors duration-200 ${
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

  const drawerModules: Array<{
    id: NavTab;
    label: string;
    desc: string;
    icon: React.ReactNode;
    badge?: string;
  }> = [
    {
      id: 'overview',
      label: 'Beranda & Peta Kejadian',
      desc: 'Sorotan real-time, filter kategori bulat, & peta GPS',
      icon: <Home className="w-4 h-4" />,
    },
    {
      id: 'per_rt',
      label: 'Katalog Mode 10 RT (RT 001–010)',
      desc: 'Grid kotak 10 RT, unduh CSV, & matriks perbandingan',
      icon: <Grid2x2 className="w-4 h-4" />,
    },
    {
      id: 'create_report',
      label: 'Kirim Laporan Foto & GPS',
      desc: 'Kamera langsung kotak 1:1 & deteksi alamat otomatis',
      icon: <Camera className="w-4 h-4" />,
    },
    {
      id: 'jumantik',
      label: 'Kampung Bebas Jentik (ABJ)',
      desc: 'Input pemeriksaan rumah kader Jumantik & rekap mingguan',
      icon: <ClipboardList className="w-4 h-4" />,
    },
    {
      id: 'analytics',
      label: 'Analisis Tren & Area Rawan',
      desc: 'Peta radius kerawanan, tren 14 hari, & jam rawan',
      icon: <BarChart3 className="w-4 h-4" />,
    },
    ...(isAdmin
      ? [
          {
            id: 'admin' as NavTab,
            label: 'Dashboard Admin & Triase',
            desc: 'Verifikasi laporan, kirim notifikasi push, & delegasi',
            icon: <ShieldCheck className="w-4 h-4" />,
            badge: openReportCount > 0 ? `${openReportCount} aktif` : undefined,
          },
        ]
      : []),
    {
      id: 'api_gateway',
      label: 'Integrasi API Instansi Terkait',
      desc: 'Endpoint GeoJSON, Open311-ID, & Webhook HMAC-SHA256',
      icon: <Globe className="w-4 h-4" />,
    },
  ];

  return (
    <div className="min-h-screen bg-[#e2e8da] flex flex-col items-center justify-center sm:py-5 sm:px-4">
      {/* Subtle Outer Studio Frame Control (Desktop Only) */}
      <div
        className={`hidden sm:flex items-center justify-between w-full mb-2 px-3 text-xs text-[#5b6649] transition-all ${
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
              <span>Bingkai Ponsel (420px)</span>
            </>
          ) : (
            <>
              <Maximize2 className="w-3 h-3" />
              <span>Perluas Layar</span>
            </>
          )}
        </button>
      </div>

      {/* Centered Mobile-App Phone Frame Shell */}
      <div
        className={`w-full ${
          frameExpanded ? 'sm:max-w-4xl' : 'sm:max-w-[420px]'
        } min-h-screen sm:min-h-0 sm:h-[856px] sm:rounded-[42px] sm:border-[7px] sm:border-[#263015] sm:shadow-2xl overflow-hidden flex flex-col relative transition-all duration-200 ${
          isSageScreen ? 'bg-[#dcecc3]' : 'bg-[#f7f9f4]'
        }`}
      >
        {/* Compact Sticky Top App Bar (54px — within 15% mobile sticky cap) */}
        <header
          className={`h-[54px] shrink-0 px-4 flex items-center justify-between gap-2 border-b z-20 ${
            isSageScreen
              ? 'bg-[#dcecc3]/95 border-[#cbe0b0]'
              : 'bg-[#f7f9f4]/95 border-[#cbe0b0]'
          } backdrop-blur-md`}
        >
          <button
            type="button"
            onClick={() => setMenuSheetOpen(true)}
            aria-label="Buka menu modul dan profil"
            className="min-h-[42px] min-w-[42px] rounded-full bg-[#586826]/10 text-[#263015] hover:bg-[#586826]/20 flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <Menu className="w-4 h-4" />
          </button>

          <div className="min-w-0 text-center">
            <p className="text-sm font-bold text-[#263015] truncate">
              {TAB_LABELS[activeTab]}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setNotifDrawerOpen(true)}
            aria-label="Buka notifikasi push"
            className="min-h-[42px] min-w-[42px] rounded-full bg-[#586826] text-[#f7f9f4] hover:bg-[#48561e] flex items-center justify-center relative transition-colors cursor-pointer shrink-0"
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

        {/* Scrollable Screen Body */}
        <main className="flex-1 overflow-y-auto phone-scroll px-4 py-4">
          {activeTab === 'overview' && (
            <div className="space-y-5">
              {/* Top Feed Scope Pill Bar + Push Trigger */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 p-1 bg-[#e6f2d3] border border-[#cbe0b0] rounded-full">
                  {(
                    [
                      { id: 'all', label: 'Semua RW' },
                      { id: 'per_rt', label: 'Per RT' },
                      { id: 'mine', label: 'Milik Saya' },
                    ] as const
                  ).map((sc) => (
                    <button
                      key={sc.id}
                      type="button"
                      onClick={() => setFeedScope(sc.id)}
                      className={`min-h-[34px] px-3 py-1 text-xs font-semibold rounded-full transition-colors whitespace-nowrap cursor-pointer ${
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

              {/* Per-RT Quick Strip when feedScope === 'per_rt' */}
              {feedScope === 'per_rt' && (
                <div className="bg-[#dcecc3] border border-[#cbe0b0] rounded-2xl p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-[#263015]">Pilih RT (10 Wilayah)</span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('per_rt')}
                      className="text-[11px] font-semibold text-[#586826] underline cursor-pointer"
                    >
                      Katalog Lengkap →
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                    {RT_UNITS.map((unit) => {
                      const count = allVisibleReports.filter((r) => r.rt === unit).length;
                      const active = overviewSelectedRt === unit;
                      return (
                        <button
                          key={unit}
                          type="button"
                          onClick={() => setOverviewSelectedRt(unit)}
                          className={`min-h-[36px] px-3 py-1 text-xs font-mono rounded-full transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            active
                              ? 'bg-[#586826] text-[#f7f9f4] font-bold'
                              : 'bg-[#f7f9f4] text-[#263015] border border-[#cbe0b0]'
                          }`}
                        >
                          {unit} ({count})
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

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

        {/* Pinned Mobile Bottom Navigation Bar (62px — Thumb-Zone Ergonomic Anchor) */}
        <nav
          aria-label="Navigasi Utama Bawah"
          className="h-[62px] shrink-0 bg-[#f7f9f4]/95 border-t border-[#cbe0b0] backdrop-blur-md grid grid-cols-5 items-center px-1.5 z-20"
        >
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`min-h-[46px] flex flex-col items-center justify-center rounded-2xl transition-colors cursor-pointer ${
              activeTab === 'overview' ? 'text-[#586826] font-bold' : 'text-[#5b6649]'
            }`}
          >
            <Home className="w-5 h-5" />
            <span className="text-[10px] mt-0.5 whitespace-nowrap">Beranda</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('per_rt')}
            className={`min-h-[46px] flex flex-col items-center justify-center rounded-2xl transition-colors cursor-pointer ${
              activeTab === 'per_rt' ? 'text-[#586826] font-bold' : 'text-[#5b6649]'
            }`}
          >
            <Grid2x2 className="w-5 h-5" />
            <span className="text-[10px] mt-0.5 whitespace-nowrap">10 RT</span>
          </button>

          {/* Center Primary Camera Report Trigger */}
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => {
                setReportPrefill(null);
                setActiveTab('create_report');
              }}
              aria-label="Kirim Laporan Kejadian"
              className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm active:scale-95 transition-all cursor-pointer ${
                activeTab === 'create_report'
                  ? 'bg-[#a5cf4c] text-[#263015] ring-2 ring-[#586826]'
                  : 'bg-[#586826] text-[#f7f9f4] hover:bg-[#48561e]'
              }`}
            >
              <Camera className="w-5 h-5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setActiveTab('jumantik')}
            className={`min-h-[46px] flex flex-col items-center justify-center rounded-2xl transition-colors cursor-pointer ${
              activeTab === 'jumantik' ? 'text-[#586826] font-bold' : 'text-[#5b6649]'
            }`}
          >
            <ClipboardList className="w-5 h-5" />
            <span className="text-[10px] mt-0.5 whitespace-nowrap">ABJ</span>
          </button>

          <button
            type="button"
            onClick={() => setMenuSheetOpen(true)}
            className={`min-h-[46px] flex flex-col items-center justify-center rounded-2xl transition-colors cursor-pointer ${
              activeTab === 'analytics' || activeTab === 'admin' || activeTab === 'api_gateway'
                ? 'text-[#586826] font-bold'
                : 'text-[#5b6649]'
            }`}
          >
            <LayoutGrid className="w-5 h-5" />
            <span className="text-[10px] mt-0.5 whitespace-nowrap">Menu</span>
          </button>
        </nav>

        {/* Bottom-Sheet Module & Citizen Profile Drawer */}
        {menuSheetOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/45 backdrop-blur-xs p-0 sm:p-4">
            <div className="w-full max-w-[420px] bg-[#f7f9f4] border border-[#cbe0b0] rounded-t-3xl sm:rounded-3xl max-h-[86vh] flex flex-col overflow-hidden shadow-xl">
              <div className="w-10 h-1.5 bg-[#586826]/25 rounded-full mx-auto mt-3" />

              <div className="px-5 py-3.5 border-b border-[#cbe0b0] flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#263015] truncate">
                    {userProfile.displayName}
                  </p>
                  <p className="text-[11px] text-[#5b6649] inline-flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-[#586826]" />
                    <span>{isAdmin ? 'Petugas Admin RW 013' : 'Warga Terverifikasi'}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMenuSheetOpen(false)}
                  aria-label="Tutup menu"
                  className="min-h-[40px] min-w-[40px] rounded-full bg-[#e6f2d3] text-[#586826] flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Domisili RT Selector */}
              <div className="px-5 py-3 bg-[#dcecc3] border-b border-[#cbe0b0] flex items-center justify-between gap-3 text-xs">
                <label htmlFor="sheet-home-rt" className="font-semibold text-[#263015]">
                  Domisili Wilayah Warga:
                </label>
                <select
                  id="sheet-home-rt"
                  value={userProfile.rt}
                  onChange={(e) => handleChangeHomeRt(e.target.value as RtUnit)}
                  className="min-h-[38px] px-3 py-1 text-xs font-mono font-bold bg-white border border-[#cbe0b0] rounded-full text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
                >
                  {RT_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u} · RW 013
                    </option>
                  ))}
                </select>
              </div>

              {/* All Navigation Destinations */}
              <div className="flex-1 overflow-y-auto phone-scroll p-3.5 space-y-2">
                {drawerModules.map((mod) => {
                  const active = activeTab === mod.id;
                  return (
                    <button
                      key={mod.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(mod.id);
                        setMenuSheetOpen(false);
                      }}
                      className={`w-full text-left p-3 rounded-2xl border transition-all flex items-center gap-3 cursor-pointer ${
                        active
                          ? 'bg-[#586826] border-[#586826] text-[#f7f9f4]'
                          : 'bg-white border-[#cbe0b0] text-[#263015] hover:bg-[#e6f2d3]'
                      }`}
                    >
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          active
                            ? 'bg-[#48561e] text-[#a5cf4c]'
                            : 'bg-[#586826] text-[#dcecc3]'
                        }`}
                      >
                        {mod.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold truncate">{mod.label}</span>
                          {mod.badge && (
                            <span
                              className={`text-[10px] font-mono font-bold shrink-0 ${
                                active ? 'text-[#a5cf4c]' : 'text-[#586826]'
                              }`}
                            >
                              {mod.badge}
                            </span>
                          )}
                        </div>
                        <p
                          className={`text-[11px] truncate ${
                            active ? 'text-[#dcecc3]' : 'text-[#5b6649]'
                          }`}
                        >
                          {mod.desc}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="p-4 border-t border-[#cbe0b0] bg-[#f7f9f4]">
                <button
                  type="button"
                  onClick={() => {
                    setMenuSheetOpen(false);
                    signOut(auth);
                  }}
                  className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-red-800 bg-white border border-red-200 rounded-full hover:bg-red-50 transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Keluar dari Sesi Akun</span>
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
