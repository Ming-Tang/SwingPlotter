'use strict';

const gpu = new GPU();

const Data = {};

var Parties, Ridings, PartiesI, RidingsI;
var SlopesA, InterceptsA;
var Res;

var dataReady = false;

const PopularVotes = {
  "Liberal": 40.0,
  "Conservative": 30.0,
  "New Democratic": 20.0,
  "Green": 5.0,
  "Bloc Québécois": 5.0,
};

const PartyKeys = {
  "Liberal": "LIB",
  "Conservative": "CON",
  "New Democratic": "NDP",
  "Green": "GRN",
  "Bloc Québécois": "BQ"
};

const files = ["models", "pe", "cre"];

function PI(i, x) { return Parties[i]; }

function RI(i, x) { return Ridings[i]; }

function obj_from_arr(keys, arr) {
  const res = {};
  for (var i = 0; i < arr.length; i++) {
    res[keys[i]] = arr[i];
  }
  return res;
}

function DKR(xs) { return obj_from_arr(Ridings, xs); }
function DKP(xs) { return obj_from_arr(Parties, xs); }
function DVP(xs) { return xs.map(PI); }

function EKP(PV) { return arr_from_obj(PartiesI, PV); }

function arr_from_obj(indices, obj) {
  const arr = [];
  for (var k in obj) {
    if (obj.hasOwnProperty(k)) {
      arr[indices[k]] = obj[k];
    }
  }

  return arr;
}

function invert(xs) {
  const res = {};
  for (var i = 0; i < xs.length; i++) {
    res[xs[i]] = i;
  }
  return res;
}

function by_riding_party(riding_ids, party_names, xs) {
  const map = {};
  const N = xs.length;
  for (var i = 0; i < N; i++) {
    const r = riding_ids[i];
    if (!(r in map)) {
      map[r] = {};
    }

    map[r][party_names[i]] = xs[i];
  }

  return map;
}

function rp_to_array2d(map, v0) {
  const arr = [];
  const R = Object.keys(Ridings).length;
  const P = Object.keys(Parties).length;
  for (var i = 0; i < R; i++) {
    arr[i] = [];
    var m = map[Ridings[i]] || {};
    for (var j = 0; j < P; j++) {
      const val = m[Parties[j]];
      arr[i].push(val === undefined ? v0 : val);
    }
  }
  return arr;
}

// evaluate at swing model at PV=PV+i*dPV1+j*dPV2 and get seat
// count for party k
function evaluateMap(
  /* P */ pvs,
  /* P */ dpvx,
  /* P */ dpvy,
  /* R*P */ slopes,
  /* R*P */ intercepts,
  p) {
  //const p = this.thread.z;
  var count = 0;
  for (var r = 0; r < this.constants.R; r++) {
    var bestI = 0;
    var bestE = -100.0;
    for (var i = 0; i < this.constants.P; i++) {
      var pv = (this.constants.x0 + this.thread.x * this.constants.dx) * dpvx[i] +
        (this.constants.y0 + this.thread.y * this.constants.dy) * dpvy[i] +
        pvs[i];

      var ev = pv * slopes[r][i] + intercepts[r][i];
      const s = step(bestE, ev);
      const s1 = step(ev, bestE);
      bestI = s1 * bestI + s * i;
      bestE = s1 * bestE + s * ev;
      //if (s > 0 /*ev > bestE*/) {
      //  bestI = i;
      //  bestE = ev;
      //}
    }

    if (bestI === p) count++;
  }
  return count;
}

var K = {
  evaluateMap: gpu.createKernel(evaluateMap),

  render: function(NX, NY, constants) {
    const kernel = gpu.createKernel(function(
        /* P */ pvs,
        /* P */ dpvx,
        /* P */ dpvy,
        /* R*P */ slopes,
        /* R*P */ intercepts) {
      const L = (1.0 * evaluateMap(pvs, dpvx, dpvy, slopes, intercepts, 3)) / 338.0;
      const N = (1.0 * evaluateMap(pvs, dpvx, dpvy, slopes, intercepts, 4)) / 338.0;
      const C = (1.0 * evaluateMap(pvs, dpvx, dpvy, slopes, intercepts, 1)) / 338.0;

      var k = 0.0;
      if (L > N && L > C) {
        if (L < 0.5) k = 0.2;
        this.color(1, k, k);
      } else if (N > L && N > C) {
        if (N < 0.5) k = 0.2;
        this.color(1, 0.5 + k, k);
      } else if (C > L && C > N) {
        if (C < 0.5) k = 0.2;
        this.color(k, k, 0.75);
      } else if (L === N && L === C) {
        this.color(1, 1, 1);
      } else if (L === N && L !== C) {
        this.color(0.5, 0.5, 0);
      } else if (L === C && L !== N) {
        this.color(0.5, 0, 0.5);
      } else if (N === C && N !== L) {
        this.color(0.2, 0.5, 0.5);
      }
      //this.color(L, N, C);
    },
    {
      constants: constants,
      output: [NX, NY],
      dimensions: [NX, NY],
      graphical: true,
      debug: false,
      outputToTexture: true,
      functions: [evaluateMap]
    }

    );
    //kernel.setGraphical(true);

    return kernel;
  }
};

function start() {
  if (!dataReady) return;

  console.log(PopularVotes);

  const pe = Data.pe, models = Data.models, cre = Data.cre;

  PartiesI = invert(Parties = _.uniq(pe.party_name));
  RidingsI = invert(Ridings = _.uniq(models.riding_id));

  const N = models.slope.length;

  SlopesA = rp_to_array2d(by_riding_party(
    models.riding_id, models.party_name, models.slope), 0.0);
  InterceptsA = rp_to_array2d(by_riding_party(
    models.riding_id, models.party_name, models.intercept), -100.0);

  const NX = 600, NY = 600;
  const constants = {
    x0: -30.0, dx: 60.0 / NX,
    y0: -30.0, dy: 60.0 / NY,
    NX: NX,
    NY: NY,
    P: Parties.length,
    R: Ridings.length,
    N: N
  };
  //const em = K.evaluateMap;
  //em.setConstants(constants);
  //em.setOutput([NX, NY, Parties.length]);
  //const PV = EKP(PopularVotes);
  //(Res = DKP(K.evaluateMap(
  //  //[5.0, 30.0, 5.0, 40.0, 20.0],
  //  [5.0, 30.0, 5.0, 30.0, 30.0],
  //  [0.0, 0.0, 0.0, -1.0, 1.0],
  //  [0.0, -1.0, 0.0, 1.0, 0.0],
  //  SlopesA,
  //  InterceptsA
  //)));

  const render = K.render(NX, NY, constants);
  //render.setOutput([NX, NY]).setGraphical(true);
  const canvas = render.getCanvas();
  $("#plotting_area")[0].appendChild(canvas);

  function draw() {
    const t0 = performance.now();
    (render(
      //[5.0, 30.0, 5.0, 30.0, 30.0],
      EKP(PopularVotes),
      [0.0, 0.0, 0.0, -1.0, 1.0],
      [0.0, -1.0, 0.0, 1.0, 0.0],
      SlopesA,
      InterceptsA
    ));
    const t1 = performance.now();
    console.log("after", t1 - t0);
    //requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  if (false) {
    const evaluate = gpu.createKernel(function evaluate(pvs, slopes, intercepts) {
      var bestI = 0;
      var bestE = -100.0;
      for (var i = 0; i < this.constants.P; i++) {
        var ev = pvs[i] * slopes[this.thread.x][i] + intercepts[this.thread.x][i];
        if (ev > bestE) {
          bestI = i;
          bestE = ev;
        }
      }
      return bestI;
    }, {
      constants: { P: Parties.length, N: N },
      output: [N]
    });

    const c = evaluate(PV, SlopesA, InterceptsA);
    //const results = DKR(DVP(Array.from(c)));
    //Res = results;
    //console.log(results);
    console.log(_.mapValues("length", _.groupBy(_.identity, _.values(Res))));
  }
}

$.when.apply(this, files.map((name) => {
  return $.getJSON("data/"+name+".json", (res) => { Data[name] = res; });
})).then(() => { dataReady = true; });

$(document).ready(() => {
  let pv_sliders = $("#pv_sliders");

  _.keys(PopularVotes).forEach((key) => {
    let party = PartyKeys[key];
    let pvId = "pv_" + party;
    let div = $("<div>", { 'class': 'slider_container' });
    div.append($("<div class='slider_label'>" + key + ": </div>"));
    let sliderElem = $("<div>", { id: pvId, 'class': 'slider' });
    div.append(sliderElem);
    pv_sliders.append(div);

    let slider = sliderElem[0];
    noUiSlider.create(slider, {
      start: PopularVotes[key],
      tooltips: true,
      range: {min: 0, max:100},
      'class': 'slider',
      pips: {
        mode: 'positions',
        values: [0,5,10,15,20,25,30,35,40,45,50,60,70,80,90,100],
        density: 1
      }
    });
    slider.noUiSlider.on('change', (value) => { PopularVotes[key] = parseFloat(value[0]); });
  });
});

