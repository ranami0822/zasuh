/** 星の集計の、件数の境目。サーバー（集計）と画面の両方で使う（外部に依存しない）。 */

/** 件数が少ないとみなす境目。これ未満は、幅を出さず、分布の割合（%）も出さない。 */
export const MIN_N_FOR_SE = 5;

/** 星の分布の割合（%）を出すか。件数が少ないと、1件の確率の割れ具合が、人数の割合と読まれるため、出さない。 */
export function showsShares(n: number): boolean {
	return n >= MIN_N_FOR_SE;
}
