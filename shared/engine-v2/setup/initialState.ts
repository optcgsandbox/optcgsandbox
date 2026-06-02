/**
 * Engine V2 — initial GameState builder.
 *
 * Takes (seed, decks) → returns a ready-to-setupGame GameState. Mints
 * instances for leader + deck cards + 10 DON per player, populates
 * cardLibrary, leaves zones unshuffled. Caller (`setupGame`) shuffles +
 * deals opening hand + opens dice_roll.
 *
 * Replaces V1's `initialState(args)` for cutover.
 */

import type { Card, LeaderCard } from '../cards/Card.js';
import {
  type CardId,
  type CardInstance,
  CURRENT_SCHEMA_VERSION,
  DON_DECK_SIZE,
  type GameState,
  type InstanceId,
  type PlayerId,
  type PlayerZones,
} from '../state/types.js';

const DON_CARD: Card = {
  id: 'DON',
  name: 'DON!!',
  kind: 'don',
  cost: null,
  power: null,
  counterValue: null,
  colors: [],
  traits: [],
  keywords: [],
  effectText: '',
};

export interface InitialStateArgs {
  readonly seed: number;
  readonly decks: Readonly<Record<PlayerId, { readonly leader: LeaderCard; readonly cards: ReadonlyArray<Card> }>>;
}

export function initialState(args: InitialStateArgs): GameState {
  const cardLibrary: Record<CardId, Card> = { [DON_CARD.id]: DON_CARD };
  const instances: Record<InstanceId, CardInstance> = {};

  let counter = 0;
  function mint(cardId: CardId, controller: PlayerId): CardInstance {
    counter += 1;
    const inst: CardInstance = {
      instanceId: `i${counter}`,
      cardId,
      controller,
      rested: false,
      summoningSick: false,
      attachedDon: [],
      attachedDonRested: [],
      perTurn: { hasAttacked: false, effectsUsed: [] },
    };
    instances[inst.instanceId] = inst;
    return inst;
  }

  const players = {} as Record<PlayerId, PlayerZones>;

  for (const pid of ['A', 'B'] as PlayerId[]) {
    const deckSpec = args.decks[pid];
    cardLibrary[deckSpec.leader.id] = deckSpec.leader;
    for (const c of deckSpec.cards) cardLibrary[c.id] = c;

    const leaderInst = mint(deckSpec.leader.id, pid);
    const deckIds: InstanceId[] = deckSpec.cards.map((c) => mint(c.id, pid).instanceId);

    const donDeck: InstanceId[] = [];
    for (let i = 0; i < DON_DECK_SIZE; i++) {
      donDeck.push(mint(DON_CARD.id, pid).instanceId);
    }

    players[pid] = {
      leader: leaderInst,
      hand: [],
      deck: deckIds,
      trash: [],
      field: [],
      stage: null,
      life: [],
      lifeFaceUp: {},
      donDeck,
      donCostArea: [],
      donRested: [],
      exile: [],
    };
  }

  const state: GameState = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    seed: args.seed,
    rngCounter: 0,
    turn: 1,
    activePlayer: 'A',
    firstPlayer: null,
    phase: 'refresh',
    controllerMode: { A: 'human', B: 'deterministic' },
    players,
    cardLibrary,
    instances,
    history: [],
    result: null,
    pending: null,
    koSourceStack: [],
    pendingDonReturned: {},
    mulliganUsed: { A: false, B: false },
    diceRoll: null,
    knownByViewer: { A: [], B: [] },
    gameRules: {},
    continuousApplyDepth: 0,
    cardsTrashedThisResolution: 0,
  };
  return state;
}
