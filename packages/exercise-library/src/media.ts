import { MediaAssetSchema, PublishedMediaAssetSchema, type MediaAsset, type PublishedMediaAsset } from '@fitadapt/shared';

/**
 * L6 for exercise media: an asset is published only with a licence on the
 * asset allowlist, a source and a rights holder. The allowlist mirrors
 * `assets.allowed` in tooling/legal/licence-policy.json (a test keeps them
 * equal); share-alike and non-commercial licences are refused.
 * Seed content ships no media (placeholders only; spec "Out of scope").
 */
export const ASSET_LICENCE_ALLOWLIST: readonly string[] = Object.freeze(['CC0-1.0', 'CC-BY-4.0', 'OFL-1.1', 'MIT', 'Apache-2.0', 'BSD-3-Clause', 'Owned']);

export type MediaPublishProblem = 'licence_missing' | 'licence_not_allowed' | 'source_missing' | 'rights_holder_missing' | 'invalid_asset';

export class MediaPublishError extends Error {
  constructor(
    readonly assetId: string,
    readonly problems: readonly MediaPublishProblem[],
  ) {
    super(`media asset ${assetId} cannot be published (L6): ${problems.join(', ')}`);
    this.name = 'MediaPublishError';
  }
}

export function mediaPublishProblems(asset: MediaAsset): MediaPublishProblem[] {
  const problems: MediaPublishProblem[] = [];
  if (!MediaAssetSchema.safeParse(asset).success) problems.push('invalid_asset');
  if (!asset.licence?.trim()) problems.push('licence_missing');
  else if (!ASSET_LICENCE_ALLOWLIST.includes(asset.licence)) problems.push('licence_not_allowed');
  if (!asset.source?.trim()) problems.push('source_missing');
  if (!asset.rightsHolder?.trim()) problems.push('rights_holder_missing');
  return problems;
}

/** Returns the published asset, or throws MediaPublishError listing every L6 problem. */
export function publishMediaAsset(asset: MediaAsset): PublishedMediaAsset {
  const problems = mediaPublishProblems(asset);
  if (problems.length > 0) throw new MediaPublishError(asset.id, problems);
  return PublishedMediaAssetSchema.parse({ ...asset, status: 'published' });
}

/**
 * Offline media packs: the published assets cached for an equipment profile.
 * In low-bandwidth mode only the reduced variants are included.
 */
export function mediaPack(assets: readonly MediaAsset[], packId: string, options: { lowBandwidth: boolean }): PublishedMediaAsset[] {
  return assets
    .filter((a): a is PublishedMediaAsset => a.status === 'published' && PublishedMediaAssetSchema.safeParse(a).success)
    .filter((a) => a.packs.includes(packId) && a.lowBandwidth === options.lowBandwidth)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}
