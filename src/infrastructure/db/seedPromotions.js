import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mongoConnection } from './mongoConnection.js';
import { syncCounters } from './counters.js';
import { MongoResourceRepository } from '../repositories/MongoResourceRepository.js';
import { COLLECTIONS } from '../../domain/collections.js';

const startAt = '2026-07-16T00:00:00+07:00';
const endAt = '2026-12-31T23:59:59+07:00';
const imageUrl = 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba';

const PROMOTIONS = [
  {
    code: 'WELCOME20', title: 'Chào mừng thành viên mới',
    description: 'Giảm 20.000đ cho đơn đầu tiên từ 80.000đ trên ứng dụng.',
    discountType: 'FIXED_AMOUNT', discountValue: 20_000, maxDiscountAmount: 20_000,
    minOrderAmount: 80_000, applicableSources: ['ONLINE'], memberOnly: true,
    firstBookingOnly: true, perMemberLimit: 1,
  },
  {
    code: 'APP10', title: 'Đặt vé trên ứng dụng',
    description: 'Giảm 10%, tối đa 30.000đ cho mọi đơn đặt vé online.',
    discountType: 'PERCENT', discountValue: 10, maxDiscountAmount: 30_000,
    minOrderAmount: 0, applicableSources: ['ONLINE'], perMemberLimit: 5,
  },
  {
    code: 'WEEKEND15', title: 'Cuối tuần IMAX & 4DX',
    description: 'Giảm 15%, tối đa 60.000đ cho IMAX/4DX cuối tuần, đơn từ 150.000đ.',
    discountType: 'PERCENT', discountValue: 15, maxDiscountAmount: 60_000,
    minOrderAmount: 150_000, applicableFormats: ['IMAX', '4DX'],
    applicableDaysOfWeek: ['SATURDAY', 'SUNDAY'], perMemberLimit: 4,
  },
  {
    code: 'FAMILY40', title: 'Đi xem phim cùng gia đình',
    description: 'Giảm 40.000đ cho đơn từ 4 vé và tổng tiền tối thiểu 300.000đ.',
    discountType: 'FIXED_AMOUNT', discountValue: 40_000, maxDiscountAmount: 40_000,
    minOrderAmount: 300_000, minTickets: 4, applicableSources: ['ONLINE', 'COUNTER'],
  },
  {
    code: 'SAVE25', title: 'Voucher giảm sâu',
    description: 'Giảm 25%, tối đa 50.000đ cho đơn từ 200.000đ.',
    discountType: 'PERCENT', discountValue: 25, maxDiscountAmount: 50_000,
    minOrderAmount: 200_000, usageLimit: 500, perMemberLimit: 3,
  },
  {
    code: 'COUNTER30', title: 'Ưu đãi mua vé tại quầy',
    description: 'Giảm 30.000đ cho hóa đơn tại quầy từ 150.000đ.',
    discountType: 'FIXED_AMOUNT', discountValue: 30_000, maxDiscountAmount: 30_000,
    minOrderAmount: 150_000, applicableSources: ['COUNTER'],
  },
];

const CONDITION_PATCHES = {
  SVDAY: { applicableDaysOfWeek: ['MONDAY'], memberOnly: true },
  WEEKENDVIP: { applicableDaysOfWeek: ['SATURDAY', 'SUNDAY'], applicableFormats: ['IMAX', '4DX'] },
  MIDWEEK50: { applicableDaysOfWeek: ['WEDNESDAY'] },
  COUPLEDRINK: {
    title: 'Ưu đãi nhóm đôi', minTickets: 2,
    description: 'Giảm 15.000đ khi đặt từ 2 vé và tổng tiền từ 150.000đ.',
  },
  PROMO11: { startHour: 20, description: 'Giảm 20% cho suất bắt đầu từ 20h.' },
  PROMO12: { minimumAdvanceHours: 72 },
  PROMO13: { minTickets: 4 },
  PROMO18: { applicableSources: ['ONLINE'] },
  PROMO20: { memberOnly: true },
  SUMMERHEATING: { applicableSources: ['ONLINE'] },
};

async function backupPromotions(existingRows) {
  const backupDir = path.resolve(process.cwd(), 'backups');
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const backupPath = path.join(backupDir, `promotion-seed-${timestamp}.json`);
  await mkdir(backupDir, { recursive: true });
  await writeFile(backupPath, JSON.stringify(existingRows, null, 2), 'utf8');
  return backupPath;
}

export async function seedPromotions(db) {
  const repository = new MongoResourceRepository(db);
  await syncCounters(db);
  const existingRows = await repository.findMany(COLLECTIONS.PROMOTION.name, {});
  const backupPath = await backupPromotions(existingRows);
  let inserted = 0;
  let updated = 0;

  for (const definition of PROMOTIONS) {
    const existing = existingRows.find((row) => String(row.code).toUpperCase() === definition.code);
    const document = { ...definition, startAt, endAt, status: 'ACTIVE', imageUrl };
    if (existing) {
      await repository.patch(COLLECTIONS.PROMOTION.name, existing.id, document);
      updated += 1;
    } else {
      const id = await repository.nextBusinessId(COLLECTIONS.PROMOTION);
      await repository.insert(COLLECTIONS.PROMOTION.name, {
        id, promotionId: id, ...document,
      });
      inserted += 1;
    }
  }

  const allRows = await repository.findMany(COLLECTIONS.PROMOTION.name, {});
  const now = Date.now();
  for (const promotion of allRows) {
    const patch = { ...(CONDITION_PATCHES[String(promotion.code).toUpperCase()] ?? {}) };
    if (promotion.endAt && Date.parse(promotion.endAt) < now) patch.status = 'EXPIRED';
    if (Object.keys(patch).length > 0) {
      await repository.patch(COLLECTIONS.PROMOTION.name, promotion.id, patch);
      updated += 1;
    }
  }
  await syncCounters(db);
  return {
    inserted,
    updated,
    total: await repository.count(COLLECTIONS.PROMOTION.name),
    backupPath,
  };
}

async function main() {
  const db = await mongoConnection.connect({ logger: console });
  console.log(JSON.stringify(await seedPromotions(db), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => mongoConnection.close())
    .catch(async (error) => {
      console.error('Promotion seed failed:', error);
      await mongoConnection.close();
      process.exitCode = 1;
    });
}
