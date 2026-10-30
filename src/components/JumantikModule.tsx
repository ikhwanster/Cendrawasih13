import React, { useEffect, useMemo, useState } from 'react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  Crosshair,
  Droplets,
  FileText,
  Home,
  Loader2,
  Trash2,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  RT_UNITS,
  VALIDATION_LIMITS,
  type JumantikLog,
  type RtUnit,
  type UserPublicProfile,
} from '../types';
import {
  DEFAULT_RW013_CENTER,
  generateSafeId,
  getIsoWeekKey,
} from '../utils/geoAndImage';
import type { PrefillReportDraft } from './CreateReportPanel';

interface JumantikModuleProps {
  logs: JumantikLog[];
  userProfile: UserPublicProfile;
  isAdmin: boolean;
  onEscalateToReport: (draft: PrefillReportDraft) => void;
}

export const JumantikModule: React.FC<JumantikModuleProps> = ({
  logs,
  userProfile,
  isAdmin,
  onEscalateToReport,
}) => {
  const todayStr = new Date().toISOString().slice(0, 10);

  const [subView, setSubView] = useState<'form' | 'recap' | 'history'>('form');
  const [inspectionDate, setInspectionDate] = useState(todayStr);
  const [rt, setRt] = useState<RtUnit>(userProfile.rt || 'RT 001');
  const [officerName, setOfficerName] = useState(userProfile.displayName || '');
  const [housesInspected, setHousesInspected] = useState<number>(20);
  const [housesWithLarvae, setHousesWithLarvae] = useState<number>(0);
  const [larvaeLocations, setLarvaeLocations] = useState('');
  const [actionTaken, setActionTaken] = useState('Edukasi 3M Plus & pengurasan penampungan air');
  const [notes, setNotes] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number }>(DEFAULT_RW013_CENTER);
  const [gpsStatus, setGpsStatus] = useState('Koordinat lingkungan RW 013');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [rtFilter, setRtFilter] = useState<string>('ALL');

  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCoords({
            lat: Number(pos.coords.latitude.toFixed(6)),
            lng: Number(pos.coords.longitude.toFixed(6)),
          });
          setGpsStatus(
            `GPS aktif (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)})`
          );
        },
        () => {
          // Keep default RW 013 center silently
        },
        { enableHighAccuracy: true, timeout: 7000 }
      );
    }
  }, []);

  const refreshGps = () => {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        });
        setGpsStatus(
          `GPS diperbarui (${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)})`
        );
      },
      () => {
        setGpsStatus('Izin GPS ditolak, menggunakan titik pusat RW 013');
      }
    );
  };

  // Cumulative ABJ RW 013
  const summary = useMemo(() => {
    let totalInspected = 0;
    let totalPositive = 0;
    for (const l of logs) {
      totalInspected += l.housesInspected;
      totalPositive += l.housesWithLarvae;
    }
    const freeHouses = Math.max(0, totalInspected - totalPositive);
    const abj =
      totalInspected > 0
        ? Number(((freeHouses / totalInspected) * 100).toFixed(1))
        : null;
    return {
      totalInspected,
      totalPositive,
      freeHouses,
      abj,
    };
  }, [logs]);

  // Per RT Recap
  const perRtStats = useMemo(() => {
    return RT_UNITS.map((unit, idx) => {
      const unitLogs = logs.filter((l) => l.rt === unit);
      const inspected = unitLogs.reduce((s, l) => s + l.housesInspected, 0);
      const positive = unitLogs.reduce((s, l) => s + l.housesWithLarvae, 0);
      const abj =
        inspected > 0 ? Number((((inspected - positive) / inspected) * 100).toFixed(1)) : null;
      return {
        rt: unit,
        shortNum: String(idx + 1).padStart(2, '0'),
        sessions: unitLogs.length,
        inspected,
        positive,
        free: Math.max(0, inspected - positive),
        abj,
      };
    });
  }, [logs]);

  // Per Week Recap
  const perWeekStats = useMemo(() => {
    const map = new Map<
      string,
      { weekKey: string; sessions: number; inspected: number; positive: number }
    >();
    for (const l of logs) {
      const existing = map.get(l.weekKey) || {
        weekKey: l.weekKey,
        sessions: 0,
        inspected: 0,
        positive: 0,
      };
      existing.sessions += 1;
      existing.inspected += l.housesInspected;
      existing.positive += l.housesWithLarvae;
      map.set(l.weekKey, existing);
    }
    return Array.from(map.values())
      .sort((a, b) => b.weekKey.localeCompare(a.weekKey))
      .map((w) => ({
        ...w,
        abj: Number((((w.inspected - w.positive) / w.inspected) * 100).toFixed(1)),
      }));
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const sorted = [...logs].sort((a, b) => b.inspectionDate.localeCompare(a.inspectionDate));
    if (rtFilter === 'ALL') return sorted;
    return sorted.filter((l) => l.rt === rtFilter);
  }, [logs, rtFilter]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!VALIDATION_LIMITS.DATE_REGEX.test(inspectionDate)) {
      setErrorMsg('Format tanggal harus YYYY-MM-DD.');
      return;
    }
    const cleanOfficer = officerName.trim().slice(0, VALIDATION_LIMITS.DISPLAY_NAME_MAX);
    if (cleanOfficer.length < 2) {
      setErrorMsg('Nama petugas / jumantik minimal 2 karakter.');
      return;
    }
    if (housesInspected < 1 || housesInspected > VALIDATION_LIMITS.JUMANTIK_MAX_HOUSES) {
      setErrorMsg('Jumlah rumah diperiksa harus antara 1 sampai 500.');
      return;
    }
    if (housesWithLarvae < 0 || housesWithLarvae > housesInspected) {
      setErrorMsg('Jumlah rumah ada jentik tidak boleh melebihi rumah diperiksa.');
      return;
    }

    const weekKey = getIsoWeekKey(inspectionDate);
    const logId = generateSafeId('abj');
    const path = `jumantikLogs/${logId}`;

    setSubmitting(true);
    try {
      await setDoc(doc(db, 'jumantikLogs', logId), {
        authorId: userProfile.uid,
        inspectionDate,
        weekKey,
        rt,
        rwCode: 'RW013',
        officerName: cleanOfficer,
        housesInspected: Math.floor(housesInspected),
        housesWithLarvae: Math.floor(housesWithLarvae),
        larvaeLocations: larvaeLocations.trim().slice(0, VALIDATION_LIMITS.JUMANTIK_FIELD_MAX),
        actionTaken: actionTaken.trim().slice(0, VALIDATION_LIMITS.JUMANTIK_FIELD_MAX),
        notes: notes.trim().slice(0, VALIDATION_LIMITS.JUMANTIK_NOTES_MAX),
        latitude: coords.lat,
        longitude: coords.lng,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setSubmitting(false);
      setHousesWithLarvae(0);
      setLarvaeLocations('');
      setNotes('');
      setSuccessMsg(`Rekap pemeriksaan jentik ${rt} (${inspectionDate}) tersimpan.`);
    } catch (error) {
      setSubmitting(false);
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const handleDeleteLog = async (logId: string) => {
    const path = `jumantikLogs/${logId}`;
    try {
      await deleteDoc(doc(db, 'jumantikLogs', logId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  return (
    <div className="space-y-5">
      {/* Reference Screen 7 Motif: Centered Circular Olive ABJ Emblem + Two Horizontal Stat Cards */}
      <section className="bg-[#dcecc3] border border-[#cbe0b0] rounded-3xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-bold text-[#263015]">
              Kampung Bebas Jentik RW 013
            </h1>
            <p className="text-xs text-[#5b6649]">Target Kemenkes RI ≥ 95,0%</p>
          </div>
          <a
            href="/assets/aistudio/ABJ_RW_013___Kampung_Bebas_Jentik_374cf83d.md"
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#586826] bg-[#f7f9f4] border border-[#cbe0b0] rounded-full hover:bg-white whitespace-nowrap shrink-0"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Pedoman</span>
          </a>
        </div>

        {/* Centered Large Circular Olive Badge (Reference Screen 7) */}
        <div className="flex flex-col items-center py-2 space-y-2.5">
          <div className="w-32 h-32 rounded-full bg-[#586826] text-[#dcecc3] flex flex-col items-center justify-center shadow-sm border-4 border-[#e6f2d3]">
            <Droplets className="w-6 h-6 text-[#a5cf4c] mb-0.5" />
            <span className="text-2xl font-bold font-mono tabular-nums text-[#f7f9f4]">
              {summary.abj === null ? '–' : `${summary.abj}%`}
            </span>
            <span className="text-[10px] font-medium text-[#dcecc3]">ABJ Kumulatif</span>
          </div>

          {summary.abj !== null && (
            <p className="text-xs font-semibold text-[#263015] inline-flex items-center gap-1.5">
              {summary.abj >= 95 ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-[#586826]" />
                  <span>Memenuhi Standar Bebas Jentik</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 text-red-700" />
                  <span className="text-red-800">Waspada Jentik (&lt;95%)</span>
                </>
              )}
            </p>
          )}
        </div>

        {/* Two Horizontal Square-Thumbnail Cards like Reference Screen 7 */}
        <div className="space-y-2.5">
          <div className="bg-[#f7f9f4] border border-[#cbe0b0] rounded-2xl p-3 flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-[#586826] text-[#dcecc3] flex items-center justify-center shrink-0">
              <Home className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-[#263015]">Total Rumah Diperiksa</p>
              <p className="text-[11px] text-[#5b6649]">
                {logs.length} kunjungan kader · {summary.freeHouses} rumah bebas jentik
              </p>
            </div>
            <span className="text-lg font-bold font-mono tabular-nums text-[#263015] shrink-0">
              {summary.totalInspected}
            </span>
          </div>

          <div className="bg-[#f7f9f4] border border-[#cbe0b0] rounded-2xl p-3 flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-[#586826] text-[#a5cf4c] flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-[#263015]">Rumah Positif Jentik</p>
              <p className="text-[11px] text-[#5b6649]">
                Terhubung otomatis ke peta rawan DBD
              </p>
            </div>
            <span
              className={`text-lg font-bold font-mono tabular-nums shrink-0 ${
                summary.totalPositive > 0 ? 'text-red-700' : 'text-[#586826]'
              }`}
            >
              {summary.totalPositive}
            </span>
          </div>
        </div>

        {/* Circular RT Quick Selector Row (Reference Screen 7 Bottom Circles) */}
        <div className="space-y-1.5 pt-1">
          <p className="text-[11px] font-semibold text-[#263015]">
            Pilih Cepat RT Pemeriksaan (10 RT)
          </p>
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
            {perRtStats.map((item) => {
              const active = rt === item.rt;
              return (
                <button
                  key={item.rt}
                  type="button"
                  onClick={() => {
                    setRt(item.rt);
                    setRtFilter(item.rt);
                  }}
                  className={`w-11 h-11 rounded-full font-mono text-xs font-bold shrink-0 flex items-center justify-center transition-all cursor-pointer ${
                    active
                      ? 'bg-[#586826] text-[#a5cf4c] ring-2 ring-[#263015]/25'
                      : 'bg-[#f7f9f4] border border-[#cbe0b0] text-[#586826] hover:bg-white'
                  }`}
                  title={`${item.rt} — ABJ: ${item.abj === null ? 'Belum cek' : `${item.abj}%`}`}
                >
                  {item.shortNum}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Segmented Mode Switcher */}
      <div className="grid grid-cols-3 gap-1 p-1 bg-[#e6f2d3] border border-[#cbe0b0] rounded-full">
        {(
          [
            { id: 'form', label: 'Input Jentik' },
            { id: 'recap', label: 'Rekap RT/Mgg' },
            { id: 'history', label: `Riwayat (${logs.length})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubView(tab.id)}
            className={`min-h-[40px] px-3 py-1.5 text-xs font-semibold rounded-full transition-colors whitespace-nowrap cursor-pointer ${
              subView === tab.id
                ? 'bg-[#586826] text-[#f7f9f4]'
                : 'text-[#5b6649] hover:text-[#263015]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Subview 1: Form Pemeriksaan Jentik */}
      {subView === 'form' && (
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-[#cbe0b0] rounded-3xl p-5 space-y-4"
        >
          <div className="border-b border-[#e6f2d3] pb-3">
            <h2 className="text-sm font-bold text-[#263015]">Form Pemeriksaan Jentik</h2>
            <p className="text-xs text-[#5b6649] mt-0.5">
              Input hasil pemantauan berkala kader Jumantik untuk {rt}
            </p>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-800">
              {errorMsg}
            </div>
          )}
          {successMsg && (
            <div className="p-3 rounded-2xl bg-[#dcecc3] border border-[#586826]/30 text-xs text-[#263015] font-medium flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#586826] shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="abj-date" className="block text-xs font-semibold text-[#263015]">
                Tanggal
              </label>
              <input
                id="abj-date"
                type="date"
                required
                value={inspectionDate}
                onChange={(e) => setInspectionDate(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 text-xs font-mono bg-[#f7f9f4] border border-[#cbe0b0] rounded-xl text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="abj-rt" className="block text-xs font-semibold text-[#263015]">
                Wilayah RT
              </label>
              <select
                id="abj-rt"
                value={rt}
                onChange={(e) => setRt(e.target.value as RtUnit)}
                className="w-full min-h-[44px] px-3 py-2 text-xs font-mono font-medium bg-[#f7f9f4] border border-[#cbe0b0] rounded-xl text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
              >
                {RT_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="abj-officer" className="block text-xs font-semibold text-[#263015]">
              Nama Petugas / Kader Jumantik
            </label>
            <input
              id="abj-officer"
              type="text"
              required
              minLength={2}
              maxLength={VALIDATION_LIMITS.DISPLAY_NAME_MAX}
              value={officerName}
              onChange={(e) => setOfficerName(e.target.value)}
              placeholder="Nama kader jumantik bertugas"
              className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#f7f9f4] border border-[#cbe0b0] rounded-xl text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="abj-inspected" className="block text-xs font-semibold text-[#263015]">
                Rumah Diperiksa
              </label>
              <input
                id="abj-inspected"
                type="number"
                min={1}
                max={VALIDATION_LIMITS.JUMANTIK_MAX_HOUSES}
                required
                value={housesInspected}
                onChange={(e) => setHousesInspected(Number(e.target.value))}
                className="w-full min-h-[44px] px-3 py-2 text-sm font-mono bg-[#f7f9f4] border border-[#cbe0b0] rounded-xl text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="abj-positive" className="block text-xs font-semibold text-[#263015]">
                Positif Jentik
              </label>
              <input
                id="abj-positive"
                type="number"
                min={0}
                max={housesInspected}
                required
                value={housesWithLarvae}
                onChange={(e) => setHousesWithLarvae(Number(e.target.value))}
                className="w-full min-h-[44px] px-3 py-2 text-sm font-mono bg-[#f7f9f4] border border-[#cbe0b0] rounded-xl text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="abj-loc" className="block text-xs font-semibold text-[#263015]">
              Lokasi Jentik Ditemukan (Jika Ada)
            </label>
            <input
              id="abj-loc"
              type="text"
              maxLength={VALIDATION_LIMITS.JUMANTIK_FIELD_MAX}
              value={larvaeLocations}
              onChange={(e) => setLarvaeLocations(e.target.value)}
              placeholder="Bak mandi, tatakan pot bunga, ban bekas..."
              className="w-full min-h-[44px] px-3.5 py-2 text-xs bg-[#f7f9f4] border border-[#cbe0b0] rounded-xl text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="abj-action" className="block text-xs font-semibold text-[#263015]">
              Tindakan Lapangan
            </label>
            <input
              id="abj-action"
              type="text"
              maxLength={VALIDATION_LIMITS.JUMANTIK_FIELD_MAX}
              value={actionTaken}
              onChange={(e) => setActionTaken(e.target.value)}
              placeholder="Pengurasan langsung, abate, edukasi warga"
              className="w-full min-h-[44px] px-3.5 py-2 text-xs bg-[#f7f9f4] border border-[#cbe0b0] rounded-xl text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="abj-notes" className="block text-xs font-semibold text-[#263015]">
              Catatan Tambahan
            </label>
            <textarea
              id="abj-notes"
              rows={2}
              maxLength={VALIDATION_LIMITS.JUMANTIK_NOTES_MAX}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Catatan kondisi lingkungan RT..."
              className="w-full px-3.5 py-2 text-xs bg-[#f7f9f4] border border-[#cbe0b0] rounded-xl text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
            />
          </div>

          <div className="flex items-center justify-between text-xs text-[#5b6649] pt-1">
            <span className="truncate">{gpsStatus}</span>
            <button
              type="button"
              onClick={refreshGps}
              className="min-h-[36px] inline-flex items-center gap-1 text-[#586826] font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>Perbarui GPS</span>
            </button>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-[#f7f9f4] bg-[#586826] rounded-full hover:bg-[#48561e] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Menyimpan Rekap...</span>
              </>
            ) : (
              <>
                <ClipboardCheck className="w-4 h-4" />
                <span>Simpan Pemeriksaan Jentik</span>
              </>
            )}
          </button>
        </form>
      )}

      {/* Subview 2: Rekap Per RT & Per Minggu */}
      {subView === 'recap' && (
        <div className="space-y-4">
          <div className="bg-white border border-[#cbe0b0] rounded-3xl overflow-hidden">
            <div className="px-4 py-3.5 border-b border-[#cbe0b0] bg-[#e6f2d3]/60 flex items-center justify-between">
              <div>
                <h2 className="text-xs font-bold text-[#263015]">Rekap ABJ 10 Wilayah RT</h2>
                <p className="text-[11px] text-[#5b6649]">Perbandingan capaian bebas jentik</p>
              </div>
              <span className="text-[11px] font-mono text-[#586826]">≥ 95%</span>
            </div>
            <div className="overflow-x-auto phone-scroll">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#cbe0b0] bg-[#f7f9f4] text-[#5b6649]">
                    <th className="py-2.5 px-3 font-semibold">RT</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Cek</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Jentik</th>
                    <th className="py-2.5 px-3 font-semibold text-right">ABJ</th>
                    <th className="py-2.5 px-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e6f2d3]">
                  {perRtStats.map((row) => (
                    <tr key={row.rt} className="hover:bg-[#f7f9f4]">
                      <td className="py-2.5 px-3 font-bold text-[#263015] font-mono whitespace-nowrap">
                        {row.rt}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#5b6649]">
                        {row.inspected}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#5b6649]">
                        {row.positive}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-[#263015]">
                        {row.abj === null ? '–' : `${row.abj}%`}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {row.abj === null ? (
                          <span className="text-[#5b6649]">Belum cek</span>
                        ) : row.abj >= 95 ? (
                          <span className="text-[#586826] font-semibold">Bebas Jentik</span>
                        ) : (
                          <span className="text-red-700 font-semibold">Rawan (&lt;95%)</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-[#cbe0b0] rounded-3xl overflow-hidden">
            <div className="px-4 py-3.5 border-b border-[#cbe0b0] bg-[#e6f2d3]/60">
              <h2 className="text-xs font-bold text-[#263015]">Rekap Mingguan RW 013</h2>
              <p className="text-[11px] text-[#5b6649]">Tren pemantauan jentik per minggu</p>
            </div>
            {perWeekStats.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#5b6649]">
                Belum ada rekap mingguan tercatat.
              </div>
            ) : (
              <div className="overflow-x-auto phone-scroll">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#cbe0b0] bg-[#f7f9f4] text-[#5b6649]">
                      <th className="py-2.5 px-3 font-semibold">Minggu</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Sesi</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Cek</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Jentik</th>
                      <th className="py-2.5 px-3 font-semibold text-right">ABJ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e6f2d3]">
                    {perWeekStats.map((w) => (
                      <tr key={w.weekKey} className="hover:bg-[#f7f9f4]">
                        <td className="py-2.5 px-3 font-mono font-bold text-[#263015]">
                          {w.weekKey}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#5b6649]">
                          {w.sessions}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#5b6649]">
                          {w.inspected}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#5b6649]">
                          {w.positive}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono tabular-nums font-bold ${
                            w.abj >= 95 ? 'text-[#586826]' : 'text-red-700'
                          }`}
                        >
                          {w.abj}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Subview 3: Riwayat Input & Eskalasi Puskesmas */}
      {subView === 'history' && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-[#263015]">
              Riwayat Input Kader Jumantik
            </span>
            <select
              aria-label="Filter RT Riwayat"
              value={rtFilter}
              onChange={(e) => setRtFilter(e.target.value)}
              className="min-h-[38px] px-3 py-1.5 text-xs font-mono bg-white border border-[#cbe0b0] rounded-full text-[#263015] focus:outline-none focus:ring-2 focus:ring-[#586826]"
            >
              <option value="ALL">Semua RT</option>
              {RT_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>

          {filteredLogs.length === 0 ? (
            <div className="bg-white border border-[#cbe0b0] rounded-3xl p-7 text-center text-xs text-[#5b6649]">
              Belum ada riwayat pemeriksaan jentik untuk filter ini.
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredLogs.map((item) => {
                const abjRow = Number(
                  (
                    ((item.housesInspected - item.housesWithLarvae) / item.housesInspected) *
                    100
                  ).toFixed(1)
                );
                return (
                  <div
                    key={item.id}
                    className="bg-white border border-[#cbe0b0] rounded-2xl p-3.5 space-y-2 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-bold text-[#263015]">
                          {item.rt} · {item.officerName}
                        </p>
                        <p className="text-[11px] font-mono text-[#5b6649]">
                          {item.inspectionDate} · {item.housesInspected} rumah cek ·{' '}
                          <span
                            className={
                              item.housesWithLarvae > 0
                                ? 'text-red-700 font-semibold'
                                : 'text-[#586826] font-semibold'
                            }
                          >
                            {item.housesWithLarvae} jentik ({abjRow}%)
                          </span>
                        </p>
                      </div>

                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => handleDeleteLog(item.id)}
                          title="Hapus log"
                          className="p-1.5 text-[#5b6649] hover:text-red-700 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {(item.larvaeLocations || item.actionTaken || item.notes) && (
                      <div className="text-[11px] text-[#5b6649] bg-[#f7f9f4] rounded-xl p-2.5 space-y-0.5">
                        {item.larvaeLocations && (
                          <p>
                            <strong className="text-[#263015]">Titik:</strong>{' '}
                            {item.larvaeLocations}
                          </p>
                        )}
                        {item.actionTaken && (
                          <p>
                            <strong className="text-[#263015]">Tindakan:</strong>{' '}
                            {item.actionTaken}
                          </p>
                        )}
                        {item.notes && <p>{item.notes}</p>}
                      </div>
                    )}

                    {item.housesWithLarvae > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          onEscalateToReport({
                            title: `Temuan ${item.housesWithLarvae} Rumah Positif Jentik di ${item.rt}`,
                            description: `Hasil pemeriksaan Jumantik (${item.officerName}) pada ${item.inspectionDate}: dari ${item.housesInspected} rumah diperiksa, ditemukan ${item.housesWithLarvae} rumah positif jentik (ABJ ${abjRow}%). Lokasi jentik: ${item.larvaeLocations || 'Penampungan air'}. Tindakan awal: ${item.actionTaken || '-'}. Mohon tindak lanjut Puskesmas.`,
                            category: 'kesehatan_jentik',
                            urgency: abjRow < 90 ? 'darurat' : 'tinggi',
                            rt: item.rt,
                            latitude: item.latitude,
                            longitude: item.longitude,
                          })
                        }
                        className="w-full min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#f7f9f4] bg-[#586826] rounded-full hover:bg-[#48561e] cursor-pointer"
                      >
                        <span>Eskalasi Laporan ke Puskesmas</span>
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
