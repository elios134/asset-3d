export interface ShipRef {
  name?: string;
  key: string;
}
export declare const EXCLUDED_NAME: RegExp;
export declare const EXCLUDED_KEY: RegExp;
export declare function isAutoExcluded(ship: ShipRef): boolean;
export declare function isExcluded(ship: ShipRef, manual?: ReadonlySet<string>): boolean;
