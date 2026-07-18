// 메인 팝업을 anchor(첫 번째 선택 상자) 주변에 배치.
// 정책: 기본은 anchor 아래(bottom). 아래 공간이 부족하면 위(top)로 flip.
// 좌우는 viewport 안쪽으로 clamp.
export function placeMainPopover(anchor, pop, gap=8){
  const vb = (globalThis.visualViewport || {
    width: innerWidth,
    height: innerHeight,
    offsetTop: scrollY,
    offsetLeft: scrollX
  });

  const ar = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();

  const margin = 8;

  const topSpace    = ar.top - (vb.offsetTop + margin);
  const bottomSpace = (vb.offsetTop + vb.height - margin) - ar.bottom;

  // X 좌표: anchor 가운데 정렬 후 viewport 안쪽으로 클램프
  let x = ar.left + (ar.width - pr.width)/2;
  x = Math.max(
    vb.offsetLeft + margin,
    Math.min(x, vb.offsetLeft + vb.width - pr.width - margin)
  );

  // 아래 우선, 안 되면 위
  let y;
  const need = pr.height + gap;
  if(bottomSpace >= need){
    y = ar.bottom + gap;
  }else{
    y = ar.top - pr.height - gap;
    // 위도 부족하면 가능한 범위로 clamp
    if(y < vb.offsetTop + margin){
      y = vb.offsetTop + margin;
    }
  }

  // 아래에 두려 했는데 아래가 overflow면 위로 다시 시도
  if(y + pr.height > vb.offsetTop + vb.height - margin){
    const yTop = ar.top - pr.height - gap;
    if(yTop >= vb.offsetTop + margin){
      y = yTop;
    }else{
      y = vb.offsetTop + vb.height - pr.height - margin;
    }
  }

  Object.assign(pop.style,{
    left:(x + window.scrollX)+"px",
    top :(y + window.scrollY)+"px"
  });
}
