/**
 * 質問数の実験（experiments/clef-mention/README.md の第6弾）で、質問を増やすために足す観点。
 * 採点の対象にはしない（正解ラベルがない）。ゲーム用 v1 の4観点と重ならないものを選んだ。
 * 質問の書式は、本番の質問セット（game-v1.ts）の direction / mention と同じ関数で作る。
 */
import type { AspectSpec } from '../src/lib/server/question-sets/game-v1';

export const FILLER_ASPECTS: AspectSpec[] = [
	{ key: 'graphics', label: 'グラフィック・映像', scope: '画質、美術、キャラクターデザイン、演出など' },
	{ key: 'localization', label: '日本語化・翻訳', scope: '文章の訳、字幕、フォントなど' },
	{ key: 'multiplayer', label: 'マルチプレイ', scope: '協力・対戦の遊びやすさ、マッチング、人の多さなど' },
	{ key: 'community', label: 'MODとコミュニティ', scope: 'MODの数、攻略情報、プレイヤー同士の交流など' },
	{ key: 'updates', label: '更新と運営', scope: '更新の頻度、追加コンテンツ、運営の対応など' },
	{ key: 'dlc', label: '追加コンテンツ（DLC）', scope: '内容、値段、買う必要があるかなど' },
	{ key: 'replay', label: 'やり込みと周回', scope: '周回、収集要素、実績の集めやすさなど' },
	{ key: 'customize', label: 'キャラクター作成・カスタマイズ', scope: '見た目や能力の作り込みの幅など' },
	{ key: 'hardware', label: '動作環境', scope: '必要なPCの性能、対応機種など' },
	{ key: 'devices', label: '入力機器への対応', scope: 'キーボード、ゲームパッド、携帯機での遊びやすさなど' },
	{ key: 'saves', label: 'セーブと引き継ぎ', scope: 'セーブの方法、データの引き継ぎ、クラウドセーブなど' },
	{ key: 'accessibility', label: 'アクセシビリティ', scope: '字幕、色覚への配慮、操作の補助など' },
	{ key: 'characters', label: '登場人物', scope: 'キャラクターの魅力、人物の描き方など' },
	{ key: 'world', label: '世界観・設定', scope: '世界の作り込み、設定の面白さなど' },
	{ key: 'voice', label: '声の演技', scope: '声優、音声の演技、吹き替えなど' },
	{ key: 'content_rating', label: '表現と年齢', scope: '暴力・性的な表現の程度、子供に向くかなど' },
	{ key: 'expectation', label: '期待との比較', scope: '宣伝や発売前の印象との違いなど' },
	{ key: 'series', label: '前作との比較', scope: 'シリーズの前作と比べた変化など' },
	{ key: 'ports', label: '他機種版の出来', scope: '別の機種への移植の出来など' },
	{ key: 'online', label: 'オンライン接続', scope: 'サーバーの安定、常時接続の必要など' },
	{ key: 'account', label: 'アカウントと認証', scope: 'ログイン、外部アカウントの必要、コピー防止の仕組みなど' },
	{ key: 'support', label: 'サポート対応', scope: '返金、問い合わせへの対応など' },
	{ key: 'family', label: '家族や友人との遊びやすさ', scope: '一緒に遊べるか、見ていて楽しいかなど' },
	{ key: 'ending', label: '結末', scope: 'エンディング、終わり方への印象など' },
	{ key: 'monetization', label: '課金要素', scope: '課金の強さ、ガチャ、課金しないと遊べないかなど' },
	{ key: 'tools', label: '制作ツール', scope: 'エディタ、MODを作るための道具など' },
	{ key: 'platform', label: 'プラットフォームの機能', scope: '実績、トロフィー、クラウド機能の対応など' },
	{ key: 'developer', label: '開発元の姿勢', scope: '開発元や販売元の発言、過去の対応など' }
];
