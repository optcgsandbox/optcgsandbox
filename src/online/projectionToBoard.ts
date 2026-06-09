// PublicGameState → OnlineBoardViewModel adapter (F-7d.2).
//
// Pure. No I/O. The adapter NEVER reveals opponent hidden state:
//   - opp hand: count only (the projection already replaces ids with
//     anonymized stubs at the worker; the adapter never resolves them).
//   - opp deck: count only.
//   - opp face-down life: count only (face-up life entries are
//     identifiable by design — they were revealed by a game effect).
//
// The view model is the only contract `OnlinePlayfield` reads. If a
// future projection adds fields, this adapter is the single point of
// resolution.

import type {
  PublicGameState,
  PublicPlayerView,
} from '@shared/server/publicProjection';
import type { PlayerId } from '@shared/engine-v2/state/types';

export interface OnlineCardView {
  readonly instanceId: string;
  readonly cardId: string;
  readonly name: string;
  readonly rested?: boolean;
  readonly summoningSick?: boolean;
}

export interface OnlineSideView {
  readonly side: PlayerId;
  readonly isViewer: boolean;
  readonly leader: OnlineCardView;
  readonly field: ReadonlyArray<OnlineCardView>;
  readonly stage: OnlineCardView | null;
  readonly hand:
    | { readonly kind: 'visible'; readonly cards: ReadonlyArray<OnlineCardView> }
    | { readonly kind: 'hidden'; readonly count: number };
  readonly deck: { readonly count: number; readonly hidden: boolean };
  readonly life: {
    readonly faceUp: ReadonlyArray<OnlineCardView>;
    readonly faceDownCount: number;
    readonly total: number;
  };
  readonly don: {
    readonly ready: number;
    readonly rested: number;
    readonly deck: number;
  };
  readonly trash: { readonly count: number };
}

export interface OnlineBoardViewModel {
  readonly viewer: PlayerId;
  readonly phase: string;
  readonly turn: number;
  readonly activePlayer: PlayerId;
  readonly firstPlayer: PlayerId;
  readonly pending: unknown;
  readonly result: unknown;
  readonly sides: { readonly A: OnlineSideView; readonly B: OnlineSideView };
}

/**
 * Build the view model from a server-provided `PublicGameState`. The
 * adapter never reaches into private state — it only consumes the
 * projection's surface, which is itself the worker's hidden-info
 * boundary (`shared/server/publicProjection.ts:75`).
 */
export function projectionToBoard(
  state: PublicGameState,
  viewer: PlayerId,
): OnlineBoardViewModel {
  const sideA = buildSide(state, 'A', viewer);
  const sideB = buildSide(state, 'B', viewer);
  return {
    viewer,
    phase: state.phase,
    turn: state.turn,
    activePlayer: state.activePlayer,
    firstPlayer: state.firstPlayer,
    pending: state.pending,
    result: state.result,
    sides: { A: sideA, B: sideB },
  };
}

function buildSide(
  state: PublicGameState,
  side: PlayerId,
  viewer: PlayerId,
): OnlineSideView {
  const p: PublicPlayerView = state.players[side];
  const isViewer = side === viewer;
  const cardLibrary = state.cardLibrary as Record<
    string,
    { id?: string; name?: string } | undefined
  >;

  const nameOf = (cardId: string): string => {
    const c = cardLibrary[cardId];
    if (c !== undefined && typeof c.name === 'string') return c.name;
    return cardId;
  };

  const instances = state.instances as Record<
    string,
    | {
        instanceId: string;
        cardId: string;
        rested?: boolean;
        summoningSick?: boolean;
      }
    | undefined
  >;

  const lookup = (id: string): OnlineCardView | null => {
    const i = instances[id];
    if (i === undefined) return null;
    const card: OnlineCardView = {
      instanceId: i.instanceId,
      cardId: i.cardId,
      name: nameOf(i.cardId),
      ...(i.rested !== undefined ? { rested: i.rested } : {}),
      ...(i.summoningSick !== undefined
        ? { summoningSick: i.summoningSick }
        : {}),
    };
    return card;
  };

  // Leader: always public on either side.
  const leaderCv: OnlineCardView = {
    instanceId: p.leader.instanceId,
    cardId: p.leader.cardId,
    name: nameOf(p.leader.cardId),
    ...(p.leader.rested !== undefined ? { rested: p.leader.rested } : {}),
    ...(p.leader.summoningSick !== undefined
      ? { summoningSick: p.leader.summoningSick }
      : {}),
  };

  // Field characters: public regardless of viewer.
  const field: OnlineCardView[] = p.field.map((inst) => ({
    instanceId: inst.instanceId,
    cardId: inst.cardId,
    name: nameOf(inst.cardId),
    ...(inst.rested !== undefined ? { rested: inst.rested } : {}),
    ...(inst.summoningSick !== undefined
      ? { summoningSick: inst.summoningSick }
      : {}),
  }));

  // Stage: public.
  const stage: OnlineCardView | null = p.stage
    ? {
        instanceId: p.stage.instanceId,
        cardId: p.stage.cardId,
        name: nameOf(p.stage.cardId),
      }
    : null;

  // Hand: visible only when handHidden=false (viewer's own side).
  const hand: OnlineSideView['hand'] = p.handHidden
    ? { kind: 'hidden', count: p.hand.length }
    : {
        kind: 'visible',
        cards: p.hand
          .map((id) => lookup(id))
          .filter((c): c is OnlineCardView => c !== null),
      };

  // Life: opp face-down entries are `__hidden_life_*` stubs; own
  // face-down entries are id-known to self but card-id unknown to
  // anyone except via peek effects. Count without resolving the card.
  const faceUp: OnlineCardView[] = [];
  let faceDownCount = 0;
  for (const id of p.life) {
    if (id.startsWith('__hidden_life_')) {
      faceDownCount += 1;
      continue;
    }
    if (p.lifeFaceUp[id] === true) {
      const cv = lookup(id);
      if (cv !== null) faceUp.push(cv);
      continue;
    }
    faceDownCount += 1;
  }

  return {
    side,
    isViewer,
    leader: leaderCv,
    field,
    stage,
    hand,
    deck: { count: p.deck.length, hidden: p.deckHidden },
    life: {
      faceUp,
      faceDownCount,
      total: p.life.length,
    },
    don: {
      ready: p.donCostArea.length,
      rested: p.donRested.length,
      deck: p.donDeck.length,
    },
    trash: { count: p.trash.length },
  };
}
