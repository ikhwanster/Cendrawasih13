import {
  assertFails,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import fs from 'node:fs';
import { afterAll, beforeAll, describe, it } from 'vitest';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-siagawarga-rw013',
    firestore: {
      rules: fs.readFileSync('firestore.rules', 'utf8'),
    },
  });

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const now = Timestamp.now();
    await setDoc(doc(db, 'users', 'uid_victim'), {
      uid: 'uid_victim',
      displayName: 'Budi Santoso',
      rt: 'RT 003',
      createdAt: now,
      updatedAt: now,
    });
    await setDoc(doc(db, 'users', 'uid_victim', 'private', 'info'), {
      uid: 'uid_victim',
      email: 'budi@example.com',
      phone: '08123456789',
      updatedAt: now,
    });
    await setDoc(doc(db, 'users', 'uid_attacker'), {
      uid: 'uid_attacker',
      displayName: 'Pelapor Uji',
      rt: 'RT 001',
      createdAt: now,
      updatedAt: now,
    });
    await setDoc(doc(db, 'reports', 'rep_open'), {
      authorId: 'uid_attacker',
      authorName: 'Pelapor Uji',
      title: 'Saluran mampet di RT 001',
      description: 'Air meluap saat hujan deras sore hari.',
      category: 'drainase_banjir',
      urgency: 'tinggi',
      status: 'menunggu',
      rt: 'RT 001',
      rwCode: 'RW013',
      visibility: 'public',
      latitude: -6.2,
      longitude: 106.8,
      address: 'Jl. Melati RT 001 RW 013',
      photoDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
      assignedAgency: '',
      adminNote: '',
      createdAt: now,
      updatedAt: now,
    });
    await setDoc(doc(db, 'reports', 'rep_done'), {
      authorId: 'uid_attacker',
      authorName: 'Pelapor Uji',
      title: 'Lampu jalan mati',
      description: 'Sudah diperbaiki petugas PJU.',
      category: 'fasilitas_umum',
      urgency: 'sedang',
      status: 'selesai',
      rt: 'RT 001',
      rwCode: 'RW013',
      visibility: 'public',
      latitude: -6.2,
      longitude: 106.8,
      address: 'Jl. Melati RT 001 RW 013',
      photoDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
      assignedAgency: 'DISHUB_PJU',
      adminNote: 'Selesai diganti lampu LED.',
      createdAt: now,
      updatedAt: now,
    });
    await setDoc(doc(db, 'notifications', 'notif_victim'), {
      recipientId: 'uid_victim',
      senderId: 'uid_admin',
      reportId: 'rep_open',
      reportTitle: 'Saluran mampet',
      newStatus: 'diproses',
      message: 'Sedang ditindaklanjuti oleh Dinas SDA.',
      read: false,
      createdAt: now,
      updatedAt: now,
    });
  });
});

afterAll(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

describe('Dirty Dozen Security Rules Audit', () => {
  const verifiedAttacker = () =>
    testEnv.authenticatedContext('uid_attacker', {
      email: 'attacker@example.com',
      email_verified: true,
    });

  it('1. Rejects identity spoofing on CitizenReport', async () => {
    const db = verifiedAttacker().firestore();
    await assertFails(
      setDoc(doc(db, 'reports', 'spoof_1'), {
        authorId: 'uid_victim',
        authorName: 'Budi Santoso',
        title: 'Laporan palsu',
        description: 'Mencoba memalsukan identitas warga lain.',
        category: 'keamanan',
        urgency: 'sedang',
        status: 'menunggu',
        rt: 'RT 003',
        rwCode: 'RW013',
        visibility: 'public',
        latitude: -6.2,
        longitude: 106.8,
        address: 'Jl. Mawar',
        photoDataUrl: '',
        assignedAgency: '',
        adminNote: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('2. Rejects shadow/ghost fields on CitizenReport', async () => {
    const db = verifiedAttacker().firestore();
    await assertFails(
      setDoc(doc(db, 'reports', 'shadow_2'), {
        authorId: 'uid_attacker',
        authorName: 'Pelapor Uji',
        title: 'Laporan dengan field siluman',
        description: 'Menyisipkan properti isVerified.',
        category: 'kebersihan',
        urgency: 'rendah',
        status: 'menunggu',
        rt: 'RT 001',
        rwCode: 'RW013',
        visibility: 'public',
        latitude: -6.2,
        longitude: 106.8,
        address: 'Jl. Melati',
        photoDataUrl: '',
        assignedAgency: '',
        adminNote: '',
        isVerified: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('3. Rejects unverified admin email spoofing', async () => {
    const spoofedAdmin = testEnv.authenticatedContext('uid_spoof_admin', {
      email: 'ikhwanster@gmail.com',
      email_verified: false,
    });
    const db = spoofedAdmin.firestore();
    await assertFails(
      updateDoc(doc(db, 'reports', 'rep_open'), {
        status: 'selesai',
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('4. Rejects PII read by non-owner', async () => {
    const db = verifiedAttacker().firestore();
    await assertFails(getDoc(doc(db, 'users', 'uid_victim', 'private', 'info')));
  });

  it('5. Rejects self-assigned admin escalation', async () => {
    const db = verifiedAttacker().firestore();
    await assertFails(
      setDoc(doc(db, 'admins', 'uid_attacker'), {
        uid: 'uid_attacker',
        grantedBy: 'uid_attacker',
        role: 'admin',
        createdAt: serverTimestamp(),
      })
    );
  });

  it('6. Rejects citizen status shortcutting', async () => {
    const db = verifiedAttacker().firestore();
    await assertFails(
      updateDoc(doc(db, 'reports', 'rep_open'), {
        status: 'selesai',
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('7. Rejects mutation of terminal-state report by citizen', async () => {
    const db = verifiedAttacker().firestore();
    await assertFails(
      updateDoc(doc(db, 'reports', 'rep_done'), {
        description: 'Mencoba mengubah laporan yang sudah selesai.',
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('8. Rejects ID poisoning with oversized or invalid characters', async () => {
    const db = verifiedAttacker().firestore();
    const poisonedId = 'a'.repeat(300);
    await assertFails(
      setDoc(doc(db, 'reports', poisonedId), {
        authorId: 'uid_attacker',
        authorName: 'Pelapor Uji',
        title: 'ID terlalu panjang',
        description: 'Deskripsi valid untuk pengujian.',
        category: 'kebersihan',
        urgency: 'rendah',
        status: 'menunggu',
        rt: 'RT 001',
        rwCode: 'RW013',
        visibility: 'public',
        latitude: -6.2,
        longitude: 106.8,
        address: 'Jl. Melati',
        photoDataUrl: '',
        assignedAgency: '',
        adminNote: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('9. Rejects Denial-of-Wallet oversized description', async () => {
    const db = verifiedAttacker().firestore();
    await assertFails(
      setDoc(doc(db, 'reports', 'oversized_9'), {
        authorId: 'uid_attacker',
        authorName: 'Pelapor Uji',
        title: 'Deskripsi raksasa',
        description: 'X'.repeat(5000),
        category: 'kebersihan',
        urgency: 'rendah',
        status: 'menunggu',
        rt: 'RT 001',
        rwCode: 'RW013',
        visibility: 'public',
        latitude: -6.2,
        longitude: 106.8,
        address: 'Jl. Melati',
        photoDataUrl: '',
        assignedAgency: '',
        adminNote: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('10. Rejects client-forged backdated createdAt timestamp', async () => {
    const db = verifiedAttacker().firestore();
    await assertFails(
      setDoc(doc(db, 'reports', 'forged_time_10'), {
        authorId: 'uid_attacker',
        authorName: 'Pelapor Uji',
        title: 'Timestamp palsu',
        description: 'Menggunakan waktu masa lalu dari klien.',
        category: 'kebersihan',
        urgency: 'rendah',
        status: 'menunggu',
        rt: 'RT 001',
        rwCode: 'RW013',
        visibility: 'public',
        latitude: -6.2,
        longitude: 106.8,
        address: 'Jl. Melati',
        photoDataUrl: '',
        assignedAgency: '',
        adminNote: '',
        createdAt: Timestamp.fromDate(new Date('2020-01-01T00:00:00Z')),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('11. Rejects impossible Jumantik larvae count > inspected houses', async () => {
    const db = verifiedAttacker().firestore();
    await assertFails(
      setDoc(doc(db, 'jumantikLogs', 'invalid_abj_11'), {
        authorId: 'uid_attacker',
        inspectionDate: '2026-10-29',
        weekKey: '2026-W44',
        rt: 'RT 001',
        rwCode: 'RW013',
        officerName: 'Siti Aminah',
        housesInspected: 10,
        housesWithLarvae: 25,
        larvaeLocations: 'Bak mandi',
        actionTaken: 'Kuras',
        notes: 'Data tidak valid',
        latitude: -6.2,
        longitude: 106.8,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it('12. Rejects unauthorized unfiltered list query on notifications', async () => {
    const db = verifiedAttacker().firestore();
    await assertFails(getDocs(collection(db, 'notifications')));
  });
});
