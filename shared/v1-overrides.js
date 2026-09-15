// v1 → v2 変換のときに、人が判断した内容を書いておくファイル。1-7 でユーザーと決めた内容を書き込む
export default {
  lines: {
    // "CR-O": { loop: { startIndex: 0 }, directions: { forward: "外回り", backward: "内回り" } }
  },
  categoryMerge: {
    // "KT-L": { "Lo-KB": "Lo" }      // 変換元の種別ID → 統合先の種別ID（同じ路線の中で）
  },
  joins: [],        // [ "<chainKeyA>", "<chainKeyB>" ] の配列。A の終点から B へ直通させる
  forbidJoins: [],  // 自動でつながれた直通をやめさせる。形は joins と同じ
  directionMap: {}, // { "<lineId>": { up: "forward"|"backward" } }。既定値は up→backward（D-006）
};
