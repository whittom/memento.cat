import { BudgetExhaustedError } from "./errors";

/**
 * Compte, pour une invocation, les appels sortants (fetch) et les requêtes D1.
 * Le plan gratuit limite les deux par invocation (50 sous-requêtes externes, 50 requêtes D1) :
 * on s'arrête proprement avant la limite. Une instance par invocation, jamais en variable de module.
 */
export class Budget {
  private fetches = 0;
  private queries = 0;

  constructor(
    private readonly fetchLimit: number,
    private readonly queryLimit: number = Number.POSITIVE_INFINITY,
  ) {}

  get remaining(): number {
    return this.fetchLimit - this.fetches;
  }

  get remainingQueries(): number {
    return this.queryLimit - this.queries;
  }

  has(fetches: number, queries = 0): boolean {
    return this.remaining >= fetches && this.remainingQueries >= queries;
  }

  take(n = 1): void {
    if (this.remaining < n) throw new BudgetExhaustedError();
    this.fetches += n;
  }

  takeQueries(n = 1): void {
    if (this.remainingQueries < n) throw new BudgetExhaustedError();
    this.queries += n;
  }

  /** fetch() qui décompte une sous-requête. */
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    this.take(1);
    return fetch(input, init);
  }
}

type AnyFn = (...args: unknown[]) => unknown;

/**
 * Enveloppe une base D1 pour décompter chaque requête (une requête par instruction d'un batch).
 * Lève BudgetExhaustedError avant d'exécuter une requête qui dépasserait le budget.
 */
export function countingDb(db: D1Database, budget: Budget): D1Database {
  const originals = new WeakMap<object, D1PreparedStatement>();

  const wrap = (stmt: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(stmt, {
      get(target, prop) {
        if (prop === "bind") {
          return (...args: unknown[]) => wrap(target.bind(...args));
        }
        if (prop === "run" || prop === "all" || prop === "first" || prop === "raw") {
          return (...args: unknown[]) => {
            budget.takeQueries(1);
            return (Reflect.get(target, prop, target) as AnyFn).apply(target, args);
          };
        }
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === "function" ? (value as AnyFn).bind(target) : value;
      },
    });
    originals.set(proxy, stmt);
    return proxy;
  };

  return new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") return (sql: string) => wrap(target.prepare(sql));
      if (prop === "batch") {
        return (statements: D1PreparedStatement[]) => {
          budget.takeQueries(statements.length);
          return target.batch(statements.map((s) => originals.get(s) ?? s));
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as AnyFn).bind(target) : value;
    },
  });
}
