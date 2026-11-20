/**
 * The Pigeons picture for other people's pages: what the Tools page's "Pigeons on the keys"
 * download is bundled from (scripts/tools-site.mjs), with three.js inside it. Only the scene, which
 * reads nothing of the studio's state; the studio itself imports pigeonScene.ts directly.
 */
export { PigeonScene, planPigeons, posedAt, overlapOf, BIRD_SHAPE, PIGEON_FLOOR } from './pigeonScene';
export type { PigeonSceneOptions, PigeonPlanResult, Posed } from './pigeonScene';
export { PIGEON_BACKGROUNDS, PIGEON_CAMERAS, BACKGROUND_FADE, everyBars, backgroundAt, cameraAt, cleanLook } from './pigeonLooks';
export type { BackgroundId, CameraId, PigeonBackground, PigeonCamera, PigeonLook } from './pigeonLooks';
