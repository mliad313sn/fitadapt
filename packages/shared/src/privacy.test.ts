import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_DELETION_CONFIRMATION,
  AccountDeletionRequestSchema,
  CONSENT_DATA_TYPES,
  ConsentRecordSchema,
  ConsentUpdateRequestSchema,
  JurisdictionSchema,
  ProfileCorrectionSchema,
} from './index.js';

const uuid = '0b9c4c1e-3f7e-4f59-9a43-2d1c3a1e8f10';
const now = '2026-09-23T10:00:00.000Z';

describe('privacy schemas', () => {
  it('lists the five consent data types of the M17 scope', () => {
    expect([...CONSENT_DATA_TYPES]).toEqual(['health', 'photos', 'wearables', 'ai_coach', 'analytics', 'partner_sharing']);
  });

  it('parses a versioned consent record', () => {
    const record = { id: uuid, dataType: 'health', decision: 'granted', version: 1, locale: 'fr', jurisdiction: 'SN', source: 'mobile', recordedAt: now };
    expect(ConsentRecordSchema.parse(record)).toEqual(record);
    expect(ConsentRecordSchema.safeParse({ ...record, version: 0 }).success).toBe(false);
    expect(ConsentRecordSchema.safeParse({ ...record, dataType: 'location' }).success).toBe(false);
  });

  it('defaults the consent source to api and validates jurisdictions', () => {
    const parsed = ConsentUpdateRequestSchema.parse({ dataType: 'analytics', decision: 'withdrawn', version: 2, locale: 'en', jurisdiction: 'FR' });
    expect(parsed.source).toBe('api');
    expect(JurisdictionSchema.safeParse('fr').success).toBe(false);
    expect(JurisdictionSchema.safeParse('FRA').success).toBe(false);
  });

  it('requires the explicit deletion confirmation', () => {
    expect(AccountDeletionRequestSchema.safeParse({ confirm: ACCOUNT_DELETION_CONFIRMATION }).success).toBe(true);
    expect(AccountDeletionRequestSchema.safeParse({ confirm: 'yes' }).success).toBe(false);
  });

  it('a correction must change something', () => {
    expect(ProfileCorrectionSchema.safeParse({ locale: 'en' }).success).toBe(true);
    expect(ProfileCorrectionSchema.safeParse({}).success).toBe(false);
  });
});
