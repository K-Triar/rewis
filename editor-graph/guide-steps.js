// 16章 操作ガイドの手順（タブごと）。ここに書いた selector・title・body をそのまま openGuide に渡す。

export const GUIDE_STEPS = {
  stations: [
    {
      selector: '.g-ws-left',
      title: '駅の一覧',
      body: '駅を探してクリックすると、図の中で選ばれます。図にまだない駅は、クリックすると図の中央に置かれます。'
    },
    {
      selector: '.g-ws-canvas',
      title: '図',
      body: '駅の四角はドラッグで動かせます。何もない場所をダブルクリックすると、そこに新しい駅を作れます。ホイールで拡大・縮小、背景のドラッグで表示位置を動かせます。'
    },
    {
      selector: '.g-ws-right',
      title: '駅の設定',
      body: '選んだ駅の名前やのりばを編集します。変更はすぐに反映され、元に戻すボタンで取り消せます。'
    },
    {
      selector: '.g-save-btn',
      title: 'サーバーに保存',
      body: '編集が終わったら、ここからサーバーに保存します。保存するまで、ほかの人には見えません。'
    }
  ],
  lines: [
    {
      selector: '.g-ws-left',
      title: '路線の一覧',
      body: '編集する路線を選びます。'
    },
    {
      selector: '.g-ws-canvas',
      title: '駅順を作る',
      body: '［駅を末尾に追加］を押してから駅をクリックすると、路線の最後に加わります。路線の線をクリックすると、その駅間に駅を入れられます。'
    },
    {
      selector: '.g-ws-ribbon',
      title: '駅の並び',
      body: '駅の順番は、ここでドラッグして並べ替えられます。'
    },
    {
      selector: '.g-ws-right',
      title: '路線の設定',
      body: '路線の形、種別、向きの名前をここで設定します。'
    }
  ],
  services: [
    {
      selector: '.g-ws-left',
      title: '運行系統の一覧',
      body: '編集する運行系統を選ぶか、［運行系統を追加］で作ります。'
    },
    {
      selector: '.g-ws-canvas',
      title: '停車駅をつなぐ',
      body: 'のりばの丸を、停まる順にクリックします。最初ののりばをもう一度クリックすると、環状運転にできます。'
    },
    {
      selector: '.g-ws-ribbon',
      title: '停車駅の並び',
      body: '停車駅と所要時間が順番に並びます。駅や駅間をクリックすると、右側で細かく設定できます。破線の駅間は、路線がまだ決まっていないところです。'
    },
    {
      selector: '.g-ws-right',
      title: '運行系統の設定',
      body: '行先、乗車・降車、所要時間、路線と種別をここで設定します。'
    }
  ],
  transfers: [
    {
      selector: '.g-ws-canvas',
      title: '乗換を登録する',
      body: 'のりばの丸から別ののりばの丸へドラッグすると、乗換を登録できます。駅の四角からドラッグすると、のりば指定なしになります。駅を動かすときは Shift を押しながらドラッグします。'
    },
    {
      selector: '.g-ws-right',
      title: '駅の中の乗換',
      body: '駅を選ぶと、のりば同士の乗換時間の表が出ます。数字を入れると登録、消すと削除です。'
    },
    {
      selector: '.g-tr-pane-switch',
      title: '既定値と駅グループ',
      body: '乗換の既定値と駅グループは、ここから切り替えて編集します。'
    }
  ]
};
