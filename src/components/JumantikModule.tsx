import React, { useEffect, useMemo, useState } from 'react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  Crosshair,
  FileText,
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
    return RT_UNITS.map((unit) => {
      const unitLogs = logs.filter((l) => l.rt === unit);
      const inspected = unitLogs.reduce((s, l) => s + l.housesInspected, 0);
      const positive = unitLogs.reduce((s, l) => s + l.housesWithLarvae, 0);
      const abj =
        inspected > 0 ? Number((((inspected - positive) / inspected) * 100).toFixed(1)) : null;
      return {
        rt: unit,
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
      setSuccessMsg(`Data pemeriksaan jentik ${rt} (${inspectionDate}) berhasil disimpan.`);
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
    <div className="space-y-8">
      {/* Header & Reference Link */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Kampung Bebas Jentik – RW 013
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Catat hasil pemeriksaan jentik tiap RT. Data tersimpan bersama secara real-time dan rekap Angka Bebas Jentik (ABJ) terhitung otomatis.
          </p>
        </div>
        <a
          href="/assets/aistudio/ABJ_RW_013___Kampung_Bebas_Jentik_374cf83d.md"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 underline underline-offset-4 whitespace-nowrap shrink-0"
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Dokumen Acuan ABJ RW 013</span>
        </a>
      </div>

      {/* Cumulative ABJ RW 013 Strip */}
      <section aria-label="ABJ RW 013 Kumulatif" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <p className="text-xs font-medium text-slate-500">ABJ RW 013 (Kumulatif)</p>
          <div className="flex items-baseline gap-2.5">
            <span className="text-3xl font-bold font-mono tabular-nums text-slate-900">
              {summary.abj === null ? '–' : `${summary.abj}%`}
            </span>
            {summary.abj !== null && (
              <span
                className={`inline-flex items-center gap-1 text-xs font-semibold ${
                  summary.abj >= 95 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {summary.abj >= 95 ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Memenuhi Target
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Waspada (&lt;95%)
                  </>
                )}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">Standar baku Kemenkes RI ≥ 95,0%</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <p className="text-xs font-medium text-slate-500">Total Rumah Diperiksa</p>
          <p className="text-3xl font-bold font-mono tabular-nums text-slate-900">
            {summary.totalInspected}
          </p>
          <p className="text-xs text-slate-500 font-mono">
            {logs.length} kunjungan kader jumantik
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <p className="text-xs font-medium text-slate-500">Rumah Bebas Jentik</p>
          <p className="text-3xl font-bold font-mono tabular-nums text-emerald-700">
            {summary.freeHouses}
          </p>
          <p className="text-xs text-slate-500">Lingkungan bersih penampungan air</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <p className="text-xs font-medium text-slate-500">Rumah Positif Jentik</p>
          <p className="text-3xl font-bold font-mono tabular-nums text-red-700">
            {summary.totalPositive}
          </p>
          <p className="text-xs text-slate-500">Terhubung ke pemetaan area rawan DBD</p>
        </div>
      </section>

      {/* Main Split: Form Pemeriksaan Jentik + Rekap Per RT & Per Minggu */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Form Pemeriksaan Jentik */}
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <div className="border-b border-slate-200 pb-3">
            <h2 className="text-base font-semibold text-slate-900">Form Pemeriksaan Jentik</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Input hasil pemantauan berkala kader jumantik tiap RT di RW 013.
            </p>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
              {errorMsg}
            </div>
          )}
          {successMsg && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
              {successMsg}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="abj-date" className="block text-xs font-semibold text-slate-700">
                Tanggal
              </label>
              <input
                id="abj-date"
                type="date"
                required
                value={inspectionDate}
                onChange={(e) => setInspectionDate(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="abj-rt" className="block text-xs font-semibold text-slate-700">
                RT
              </label>
              <select
                id="abj-rt"
                value={rt}
                onChange={(e) => setRt(e.target.value as RtUnit)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
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
            <label htmlFor="abj-officer" className="block text-xs font-semibold text-slate-700">
              Nama Petugas / Jumantik
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
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="abj-inspected" className="block text-xs font-semibold text-slate-700">
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
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="abj-positive" className="block text-xs font-semibold text-slate-700">
                Rumah Ada Jentik
              </label>
              <input
                id="abj-positive"
                type="number"
                min={0}
                max={housesInspected}
                required
                value={housesWithLarvae}
                onChange={(e) => setHousesWithLarvae(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="abj-loc" className="block text-xs font-semibold text-slate-700">
              Lokasi Jentik Ditemukan (Jika Ada)
            </label>
            <input
              id="abj-loc"
              type="text"
              maxLength={VALIDATION_LIMITS.JUMANTIK_FIELD_MAX}
              value={larvaeLocations}
              onChange={(e) => setLarvaeLocations(e.target.value)}
              placeholder="Contoh: Bak mandi, tatakan pot bunga, ban bekas..."
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="abj-action" className="block text-xs font-semibold text-slate-700">
              Tindakan yang Dilakukan
            </label>
            <input
              id="abj-action"
              type="text"
              maxLength={VALIDATION_LIMITS.JUMANTIK_FIELD_MAX}
              value={actionTaken}
              onChange={(e) => setActionTaken(e.target.value)}
              placeholder="Contoh: Pengurasan langsung, pemberian bubuk abate, edukasi warga"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="abj-notes" className="block text-xs font-semibold text-slate-700">
              Catatan Tambahan
            </label>
            <textarea
              id="abj-notes"
              rows={2}
              maxLength={VALIDATION_LIMITS.JUMANTIK_NOTES_MAX}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Catatan kondisi lingkungan RT..."
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
            <span className="truncate">{gpsStatus}</span>
            <button
              type="button"
              onClick={refreshGps}
              className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-900 font-medium whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>Perbarui GPS</span>
            </button>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
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

        {/* Rekap Per RT & Per Minggu */}
        <div className="lg:col-span-7 space-y-6">
          {/* Per RT */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Rekap Per RT</h2>
                <p className="text-xs text-slate-500">
                  Perbandingan Angka Bebas Jentik (ABJ) antar-RT di lingkungan RW 013
                </p>
              </div>
              <span className="text-xs font-mono text-slate-500">Target ≥ 95%</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="py-2.5 px-4 font-semibold">Wilayah</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Diperiksa</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Ada Jentik</th>
                    <th className="py-2.5 px-4 font-semibold text-right">ABJ (%)</th>
                    <th className="py-2.5 px-4 font-semibold">Status Kerawanan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {perRtStats.map((row) => (
                    <tr key={row.rt} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-4 font-medium text-slate-900 font-mono">
                        {row.rt}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                        {row.inspected}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                        {row.positive}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {row.abj === null ? '–' : `${row.abj}%`}
                      </td>
                      <td className="py-2.5 px-4">
                        {row.abj === null ? (
                          <span className="text-slate-400">Belum diperiksa</span>
                        ) : row.abj >= 95 ? (
                          <span className="text-emerald-700 font-medium">Bebas Jentik</span>
                        ) : (
                          <span className="text-red-700 font-semibold">Rawan DBD (&lt;95%)</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Per Minggu */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">Rekap Per Minggu</h2>
              <p className="text-xs text-slate-500">
                Perkembangan mingguan surveilans jentik nyamuk RW 013
              </p>
            </div>
            {perWeekStats.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                Belum ada riwayat pemeriksaan mingguan. Silakan catat pemeriksaan pertama pada formulir di samping.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <th className="py-2.5 px-4 font-semibold">Minggu</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Kunjungan RT</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Rumah Diperiksa</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Positif Jentik</th>
                      <th className="py-2.5 px-4 font-semibold text-right">Capaian ABJ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {perWeekStats.map((w) => (
                      <tr key={w.weekKey} className="hover:bg-slate-50/80">
                        <td className="py-2.5 px-4 font-mono font-medium text-slate-900">
                          {w.weekKey}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                          {w.sessions}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                          {w.inspected}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                          {w.positive}
                        </td>
                        <td
                          className={`py-2.5 px-4 text-right font-mono tabular-nums font-semibold ${
                            w.abj >= 95 ? 'text-emerald-700' : 'text-red-700'
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
      </div>

      {/* Riwayat Input */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Riwayat Input Pemeriksaan</h2>
            <p className="text-xs text-slate-500">
              Daftar lengkap pencatatan jumantik beserta tindakan lapangan
            </p>
          </div>
          <select
            aria-label="Filter RT Riwayat"
            value={rtFilter}
            onChange={(e) => setRtFilter(e.target.value)}
            className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            <option value="ALL">Semua Wilayah RT</option>
            {RT_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>

        {filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Belum ada riwayat input pemeriksaan jentik untuk filter ini.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="py-3 px-4 font-semibold">Tanggal</th>
                  <th className="py-3 px-4 font-semibold">RT</th>
                  <th className="py-3 px-4 font-semibold">Petugas / Jumantik</th>
                  <th className="py-3 px-4 font-semibold text-right">Diperiksa</th>
                  <th className="py-3 px-4 font-semibold text-right">Ada Jentik</th>
                  <th className="py-3 px-4 font-semibold">Lokasi Jentik & Tindakan</th>
                  <th className="py-3 px-4 font-semibold text-right">Tindak Lanjut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLogs.map((item) => {
                  const abjRow = Number(
                    (
                      ((item.housesInspected - item.housesWithLarvae) / item.housesInspected) *
                      100
                    ).toFixed(1)
                  );
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/80 align-top">
                      <td className="py-3 px-4 font-mono whitespace-nowrap text-slate-800">
                        {item.inspectionDate}
                      </td>
                      <td className="py-3 px-4 font-mono whitespace-nowrap font-medium text-slate-900">
                        {item.rt}
                      </td>
                      <td className="py-3 px-4 text-slate-800">{item.officerName}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                        {item.housesInspected}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        <span
                          className={
                            item.housesWithLarvae > 0
                              ? 'text-red-700 font-semibold'
                              : 'text-emerald-700 font-medium'
                          }
                        >
                          {item.housesWithLarvae} ({abjRow}%)
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-600 max-w-xs space-y-0.5">
                        {item.larvaeLocations ? (
                          <p>
                            <span className="font-medium text-slate-800">Titik:</span>{' '}
                            {item.larvaeLocations}
                          </p>
                        ) : (
                          <p className="text-slate-400">Tidak ditemukan jentik</p>
                        )}
                        {item.actionTaken && (
                          <p>
                            <span className="font-medium text-slate-800">Tindakan:</span>{' '}
                            {item.actionTaken}
                          </p>
                        )}
                        {item.notes && <p className="text-slate-500">{item.notes}</p>}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
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
                              className="inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:text-red-900 underline underline-offset-2 cursor-pointer"
                            >
                              <span>Eskalasi Puskesmas</span>
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => handleDeleteLog(item.id)}
                              title="Hapus log"
                              className="p-1 text-slate-400 hover:text-red-700 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
