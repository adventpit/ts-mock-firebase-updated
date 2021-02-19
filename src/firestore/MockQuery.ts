import {
  CollectionReference,
  DocumentChange,
  DocumentData,
  FieldPath,
  FirebaseFirestore,
  FirestoreDataConverter,
  FirestoreError,
  GetOptions,
  OrderByDirection,
  Query,
  QueryDocumentSnapshot,
  QuerySnapshot,
  SnapshotListenOptions, WhereFilterOp
} from '@firebase/firestore-types';
import { MockCollectionReference } from './MockCollectionReference';
import MockDocumentReference, { FirebaseErrorFunction } from './MockDocumentReference';
import MockQueryDocumentSnapshot from './MockQueryDocumentSnapshot';
import MockQuerySnapshot from './MockQuerySnapshot';
import { NotImplementedYet } from './utils/NotImplementedYet';

import { MockSubscriptionFunction } from './MockDocumentReference';
import { findIndexForDocument, MockFirebaseValidationError } from './utils';
import MockCallbackHandler from './utils/CallbackHandler';
import { filterDocumentsByRules } from './utils/matching';
import { sortDocumentsByRules } from './utils/sortings';

export interface MockQueryOrderRule {
  fieldPath: string | FieldPath;
  directionStr?: OrderByDirection;
}
export interface MockQueryWhereRule {
  fieldPath: string | FieldPath;
  opStr: WhereFilterOp;
  value: any;
}

export interface MockQueryStartRule {
  fieldValues: any[];
  startAt: 'at' | 'after';
}

export interface MockQueryEndRule {
  fieldValues: any[];
  endAt: 'before' | 'at';
}

interface MockQueryRules {
  /**
   * An array of order rules to define the sorting order of documents. Each rule
   * defines the field for sorting and ascending or descending order to do so. Sorting
   * is read from the left to right.
   *
   * @type {MockQueryOrderRule[]}
   * @memberof MockQueryRules
   */
  order?: MockQueryOrderRule[];

  /**
   * Where rules defines the sub set of the documents that query will fetch. Each
   * where rule will define a field, operation and value to match documents to be
   * be part of query result.
   *
   * @type {MockQueryWhereRule[]}
   * @memberof MockQueryRules
   */
  where?: MockQueryWhereRule[];

  /**
   * Define the set of field values to define the first document ot a document before the
   * the first document to be filtered on result set. Field values define matches for fields
   * defined in order fields.
   *
   * @type {MockQueryStartRule}
   * @memberof MockQueryRules
   */
  start?: MockQueryStartRule;

  /**
   * Define the set of field values to define the last document or document before the last to
   * be filtered on result set. Field values define matches for fields defined in order fields.
   *
   * @type {MockQueryStartRule}
   * @memberof MockQueryRules
   */
  end?: MockQueryEndRule;

  /**
   * Limit the lenght of the result set to be in result set.
   *
   * @type {number}
   * @memberof MockQueryRules
   */
  limit?: number;
}

export type MockQuerySnapshotCallback = <T>(snapshot: QuerySnapshot<T>) => void;
/**
 * A `Query` refers to a Query which you can read or listen to. You can also
 * construct refined `Query` objects by adding filters and ordering.
 */
export default class MockQuery<T = DocumentData> implements Query<T> {
  public docRefs: MockDocumentReference<T>[];
  /**
   * The `Firestore` for the Firestore database (useful for performing
   * transactions, etc.).
   */
  public firestore: FirebaseFirestore;
  private _snapshotCallbackHandler = new MockCallbackHandler<QuerySnapshot<T>>();
  private unsubscribeCollection: () => void;

  public constructor(
    public collectionRef: CollectionReference<T>,
    docRefs: MockDocumentReference<T>[],
    private rules: MockQueryRules = {}
  ) {
    this.firestore = collectionRef.firestore;
    this.docRefs = docRefs.slice();
    this.unsubscribeCollection = this.collectionRef.onSnapshot(this.handleCollectionSnapshotChange as any);
  }

  public reset = () => {
    this.unsubscribeCollection();
  }

  /**
   * Creates and returns a new Query with the additional filter that documents
   * must contain the specified field and the value should satisfy the
   * relation constraint provided.
   *
   * @param fieldPath The path to compare
   * @param opStr The operation string (e.g "<", "<=", "==", ">", ">=").
   * @param value The value for comparison
   * @return The created Query.
   */
  public where = (fieldPath: string | FieldPath, opStr: WhereFilterOp, value: any): Query<T> => {
    const result = this.createClone();
    const where: MockQueryWhereRule[] = result.rules.where || [];
    where.push({
      fieldPath,
      opStr,
      value,
    });
    result.rules.where = where;
    return result as unknown as Query<T>;
  }

  /**
   * Creates and returns a new Query that's additionally sorted by the
   * specified field, optionally in descending order instead of ascending.
   *
   * @param fieldPath The field to sort by.
   * @param directionStr Optional direction to sort by ('asc' or 'desc'). If
   * not specified, order will be ascending.
   * @return The created Query.
   */
  public orderBy = (fieldPath: string | FieldPath, directionStr: OrderByDirection = 'asc'): Query<T> => {
    const result = this.createClone();
    const rules = result.rules.order || ([] as MockQueryOrderRule[]);
    rules.push({
      fieldPath,
      directionStr,
    });
    result.rules.order = rules;
    return result as unknown as Query<T>;
  }

  /**
   * Creates and returns a new Query that's additionally limited to only
   * return up to the specified number of documents.
   *
   * @param limit The maximum number of items to return.
   * @return The created Query.
   */
  public limit = (limit: number): Query<T> => {
    if (limit <= 0) {
      throw new MockFirebaseValidationError('Query limit value must be greater than zero');
    }
    const result = this.createClone();
    result.rules.limit = limit;
    return result as unknown as Query<T>;
  }

  public limitToLast = (limit: number): Query<T> => {
    throw new NotImplementedYet("MockQuery.limitToLast");
  }
  /**
   * Creates and returns a new Query that starts at the provided document
   * (inclusive). The starting position is relative to the order of the query.
   * The document must contain all of the fields provided in the orderBy of
   * this query.
   *
   * @param snapshot   The snapshot of the document to start at.
   * or
   * @param fieldValues The field values to start this query at, in order
   * @return The created Query.
   */
  public startAt = (...fieldValues: any[]): Query<T> => {
    // TODO startAt / startAfter called multiple times?
    this.rules = this.createStartRule(fieldValues, 'at');
    return this as unknown as Query<T>;
  }

  // /**
  //  * Creates and returns a new Query that starts at the provided fields
  //  * relative to the order of the query. The order of the field values
  //  * must match the order of the order by clauses of the query.
  //  *
  //  * @param fieldValues The field values to start this query at, in order
  //  * of the query's order by.
  //  * @return The created Query.
  //  */
  // startAt(...fieldValues: any[]): Query;

  /**
   * Creates and returns a new Query that starts after the provided document
   * (exclusive). The starting position is relative to the order of the query.
   * The document must contain all of the fields provided in the orderBy of
   * this query.
   *
   * @param snapshot The snapshot of the document to start after.
   * @param fieldValues The field values to start this query after, in order
   * @return The created Query.
   */
  public startAfter = (...fieldValues: any[]): Query<T> => {
    this.rules = this.createStartRule(fieldValues, 'after');
    return this as unknown as Query<T>;
  }

  /**
   * Creates and returns a new Query that starts after the provided fields
   * relative to the order of the query. The order of the field values
   * must match the order of the order by clauses of the query.
   *
   * @param fieldValues The field values to start this query after, in order
   * of the query's order by.
   * @return The created Query.
   */
  // startAfter(...fieldValues: any[]): Query;

  /**
   * Creates and returns a new Query that ends before the provided document
   * (exclusive). The end position is relative to the order of the query. The
   * document must contain all of the fields provided in the orderBy of this
   * query.
   *
   * @param snapshot The snapshot of the document to end before.
   * @param fieldValues The field values to end this query before, in order
   * @return The created Query.
   */
  public endBefore = (...fieldValues: any[]): Query<T> => {
    this.rules = this.createEndRule(fieldValues, 'before');
    return this as unknown as Query<T>;
  }

  /**
   * Creates and returns a new Query that ends before the provided fields
   * relative to the order of the query. The order of the field values
   * must match the order of the order by clauses of the query.
   *
   * @param fieldValues The field values to end this query before, in order
   * of the query's order by.
   * @return The created Query.
   */
  // endBefore(...fieldValues: any[]): Query;

  /**
   * Creates and returns a new Query that ends at the provided document
   * (inclusive). The end position is relative to the order of the query. The
   * document must contain all of the fields provided in the orderBy of this
   * query.
   *
   * @param snapshot The snapshot of the document to end at.
   * @param fieldValues The field values to end this query at, in order
   * @return The created Query.
   */
  public endAt = (...fieldValues: any[]): Query<T> => {
    this.rules = this.createEndRule(fieldValues, 'at');
    return this as unknown as Query<T>;
  }

  /**
   * Creates and returns a new Query that ends at the provided fields
   * relative to the order of the query. The order of the field values
   * must match the order of the order by clauses of the query.
   *
   * @param fieldValues The field values to end this query at, in order
   * of the query's order by.
   * @return The created Query.
   */
  // endAt(...fieldValues: any[]): Query;

  /**
   * Returns true if this `Query` is equal to the provided one.
   *
   * @param other The `Query` to compare against.
   * @return true if this `Query` is equal to the provided one.
   */
  public isEqual = (other: Query): boolean => {
    return this === other;
  }

  /**
   * Executes the query and returns the results as a QuerySnapshot.
   *
   * Note: By default, get() attempts to provide up-to-date data when possible
   * by waiting for data from the server, but it may return cached data or fail
   * if you are offline and the server cannot be reached. This behavior can be
   * altered via the `GetOptions` parameter.
   *
   * @param options An object to configure the get behavior.
   * @return A Promise that will be resolved with the results of the Query.
   */
  public get = (options?: GetOptions): Promise<QuerySnapshot<T>> => {
    try {
      const docs = this.getFilterDocumentReferences();
      return Promise.resolve<QuerySnapshot<T>>(new MockQuerySnapshot<T>(
        this as any, this.getDocumentSnapshots(docs) as any, []) as any);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Attaches a listener for QuerySnapshot events. You may either pass
   * individual `onNext` and `onError` callbacks or pass a single observer
   * object with `next` and `error` callbacks.
   *
   * NOTE: Although an `onCompletion` callback can be provided, it will
   * never be called because the snapshot stream is never-ending.
   *
   * @param options Options controlling the listen behavior.
   * @param onNext A callback to be called every time a new `QuerySnapshot`
   * is available.
   * @param onError A callback to be called if the listen fails or is
   * cancelled. No further callbacks will occur.
   * @param observer A single object containing `next` and `error` callbacks.
   * @return An unsubscribe function that can be called to cancel
   * the snapshot listener.
   */
  public onSnapshot = ((
    optionsOrObserverOrOnNext: SnapshotListenOptions | MockQuerySnapshotObserver | MockQuerySnapshotCallback,
    observerOrOnNextOrOnError?: MockQuerySnapshotObserver | MockQuerySnapshotCallback | FirebaseErrorFunction,
    onErrorOrOnCompletion?: FirebaseErrorFunction | MockSubscriptionFunction
  ): MockSubscriptionFunction => {
    if (typeof optionsOrObserverOrOnNext === 'function') {
      this._snapshotCallbackHandler.add(optionsOrObserverOrOnNext);
      return () => this._snapshotCallbackHandler.remove(optionsOrObserverOrOnNext);
    }
    throw new NotImplementedYet('MockQuery.onSnapshot');
  }) as any;

  /**
   * Handle onSnapshot callbacks for document changes that have impact on this query.
   * @memberof MockQuery
   */
  public handleCollectionSnapshotChange = (snapshot: QuerySnapshot<T>) => {
    const oldDocs = this.getFilterDocumentReferences();
    this.docRefs = (this.collectionRef as unknown as MockCollectionReference<T>).mocker.docRefs();
    const newDocs = this.getFilterDocumentReferences();

    const docChanges: DocumentChange[] = [];

    snapshot.docChanges().forEach(change => {
      const docId: string = change.doc.id;
      const oldIndex = oldDocs.findIndex(d => d.id === docId);
      const newIndex = newDocs.findIndex(d => d.id === docId);

      switch (change.type) {
        case 'modified':
        case 'removed': {
          if (oldIndex >= 0) {
            docChanges.push({
              ...change,
              oldIndex,
              newIndex,
            });
          }
          break;
        }
        case 'added': {
          if (newIndex >= 0) {
            docChanges.push({
              ...change,
              oldIndex,
              newIndex,
            });
          }
          break;
        }

        default:
          throw new Error(`Unexpected change type: ${change.type}`);
      }
    });
    if (docChanges.length > 0) {
      this._snapshotCallbackHandler.fire(
        new MockQuerySnapshot<T>(snapshot.query, this.getDocumentSnapshots(newDocs), docChanges) as any
      );
    }
  }

  public withConverter = <U>(converter: FirestoreDataConverter<U>): Query<U> => {
    throw new NotImplementedYet('MockQuery.withConverter');
  }

  private createClone = (): MockQuery<T> => {
    return new MockQuery(this.collectionRef, this.docRefs, this.rules);
  }

  private getDocumentSnapshots = (docRefs: MockDocumentReference<T>[] = this.docRefs): QueryDocumentSnapshot<T>[] => {
    return docRefs.map(doc => new MockQueryDocumentSnapshot<T>(doc) as unknown as QueryDocumentSnapshot<T>);
  }

  private getFilterDocumentReferences = () => {
    let docs = this.docRefs;
    const { limit, where, order, start, end } = this.rules;

    docs = filterDocumentsByRules(docs, where);
    docs = sortDocumentsByRules(docs, order);

    if (start) {
      if (!order) {
        throw new MockFirebaseValidationError(
          `${start.startAt ? 'StartAt' : 'StartBefore'} needs to match with query order but order is not defined.`
        );
      }
      const index = findIndexForDocument(docs, order.map(field => field.fieldPath), start.fieldValues);
      if (index >= 0) {
        docs = docs.slice(start.startAt === 'at' ? index : index + 1);
      }
    }

    if (end) {
      if (!order) {
        throw new MockFirebaseValidationError(
          `${end.endAt ? 'beforeAt' : 'at'} needs to match with query order but order is not defined.`
        );
      }
      const index = findIndexForDocument(docs, order.map(field => field.fieldPath), end.fieldValues);
      if (index >= 0) {
        docs = docs.slice(0, end.endAt === 'at' ? index + 1 : index);
      }
    }

    if (limit) {
      docs = docs.slice(0, Math.min(docs.length, limit));
    }
    return docs;
  }

  private createStartRule = (fieldValues: any[], startAt: 'at' | 'after') => {
    return {
      ...this.rules,
      start: {
        fieldValues,
        startAt,
      },
    };
  }

  private createEndRule = (fieldValues: any[], endAt: 'before' | 'at'): MockQueryRules => {
    return {
      ...this.rules,
      end: {
        fieldValues,
        endAt,
      },
    };
  }
}

export interface MockQuerySnapshotObserver {
  next?: (snapshot: QuerySnapshot) => void;
  error?: (error: FirestoreError) => void;
  complete?: () => void;
}
