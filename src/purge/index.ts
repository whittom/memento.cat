import { rehomeDependents } from "../dedupe";
import { HttpError } from "../lib/errors";
import { log } from "../lib/log";
import {
  countPostsOfCreator,
  deleteCreatorRow,
  deletePosts,
  getCreator,
  postsOfCreator,
  setCreatorState,
  type PostRow,
} from "../storage/db";
import { creatorPrefix } from "../storage/keys";
import { deletePrefix } from "../storage/r2";

const BATCH = 10;

export interface PurgeProgress {
  remaining: number;
  done: boolean;
}

/**
 * Efface définitivement des publications : leurs fichiers R2 (médias, miniatures, post.json) d'abord,
 * puis leurs lignes D1 (médias, index de recherche, publication). Dans cet ordre : si l'effacement R2
 * échoue, les lignes D1 restent et l'opération se reprend sans fichier orphelin. Idempotent.
 * `rehome` : les doublons d'autres publications qui se servent de leurs fichiers sont d'abord relogés
 * (exigence 9.5) ; inutile quand tout le créateur est effacé (le lien ne sort jamais du créateur).
 */
export async function purgePosts(env: Env, posts: Pick<PostRow, "id" | "r2_prefix">[], opts: { rehome?: boolean } = {}): Promise<void> {
  if (opts.rehome !== false) await rehomeDependents(env, posts.map((p) => p.id));
  for (const post of posts) {
    // Une publication compte peu de fichiers : une ou deux listes suffisent.
    for (let i = 0; i < 5 && (await deletePrefix(env.MEDIA, post.r2_prefix)); i++);
  }
  await deletePosts(env.DB, posts.map((p) => p.id));
}

/**
 * Suppression physique par lots. Le créateur passe à l'état « purging » (masqué, non collecté) ;
 * chaque appel efface un lot de publications et leurs fichiers, puis la galerie rappelle
 * jusqu'à done = true. Une interruption se reprend simplement en rappelant.
 */
export async function purgeBatch(env: Env, creatorId: string): Promise<PurgeProgress> {
  const creator = await getCreator(env.DB, creatorId);
  if (!creator) throw new HttpError(404, "Créateur introuvable");
  if (creator.state !== "purging") await setCreatorState(env.DB, creatorId, "purging", creator.deleted_at);

  await purgePosts(env, await postsOfCreator(env.DB, creatorId, BATCH), { rehome: false });

  const remaining = await countPostsOfCreator(env.DB, creatorId);
  if (remaining > 0) return { remaining, done: false };

  // Derniers fichiers orphelins éventuels sous le préfixe du créateur.
  if (await deletePrefix(env.MEDIA, creatorPrefix(creator.platform, creator.id))) {
    return { remaining: 0, done: false };
  }
  await deleteCreatorRow(env.DB, creatorId);
  log.info("créateur effacé définitivement", { creator: creatorId });
  return { remaining: 0, done: true };
}
