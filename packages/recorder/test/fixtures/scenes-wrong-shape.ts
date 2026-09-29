import scenes from "./scenes.js";

/**
 * Scenes as an array, the way a clip file may default-export clips. An array
 * has no ids, only indexes, so a reader that took its keys would have offered
 * scenes called "0".
 */
export default Object.values(scenes);
