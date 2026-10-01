import { BlueskyConnector } from "./bluesky";
import { MastodonConnector } from "./mastodon";
import { RedditConnector } from "./reddit";
import type { Connector, ConnectorContext, Platform } from "./types";

/** Crée un jeu de connecteurs pour une invocation (jamais partagé entre invocations). */
export function createConnectors(ctx: ConnectorContext): Record<Platform, Connector> {
  return {
    bluesky: new BlueskyConnector(ctx),
    reddit: new RedditConnector(ctx),
    mastodon: new MastodonConnector(ctx),
  };
}
