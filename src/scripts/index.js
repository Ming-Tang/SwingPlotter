'use strict';

const gpu = new GPU();

var files = ["models", "pe", "cre"];

const Data = {};

var Parties, Ridings, PartiesI, RidingsI;

var SlopesA, InterceptsA;

var Res;

var PopularVotes = {
  "Liberal": 40.0,
  "Conservative": 30.0,
  "New Democratic": 20.0,
  "Green": 5.0,
  "Bloc Québécois": 5.0,
};

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


var K = {
  // evaluate at swing model at PV=PV+i*dPV1+j*dPV2 and get seat
  // count for party k
  evaluateMap:
    gpu.createKernel(
      function evaluateMap(
        /* P */ pvs,
        /* P */ dpvx,
        /* P */ dpvy,
        /* R*P */ slopes,
        /* R*P */ intercepts) {

        const p = this.thread.z;
        var count = 0;
        for (var r = 0; r < this.constants.R; r++) {
          var bestI = 0;
          var bestE = -100.0;
          for (var i = 0; i < this.constants.P; i++) {
            var pv = (this.constants.x0 + this.thread.x * this.constants.dx) * dpvx[i] +
              (this.constants.y0 + this.thread.y * this.constants.dy) * dpvy[i] +
              pvs[i];

            var ev = pv * slopes[r][i] + intercepts[r][i];
            if (ev > bestE) {
              bestI = i;
              bestE = ev;
            }
          }
          if (bestI === p) count++;
        }
        return count;
      }
    ),

  render: function(NX, NY) {
    return gpu.createKernel(function(data1, data2, data3) {
      const L = data1[this.thread.y][this.thread.x] / 338.0;
      const N = data2[this.thread.y][this.thread.x] / 338.0;
      const C = data3[this.thread.y][this.thread.x] / 338.0;

      var k = 0;
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
    }, {
      output: [NX, NY],
      dimensions: [NX, NY],
      graphical: true,
      debug: false
    })
  }
};

function start() {
	const pe = Data.pe, models = Data.models, cre = Data.cre;

	PartiesI = invert(Parties = _.uniq(pe.party_name));
	RidingsI = invert(Ridings = _.uniq(models.riding_id));

	const N = models.slope.length;

	SlopesA = rp_to_array2d(by_riding_party(
    models.riding_id, models.party_name, models.slope), 0.0);
	InterceptsA = rp_to_array2d(by_riding_party(
    models.riding_id, models.party_name, models.intercept), -100.0);

  const NX = 600, NY = 600;
  const em = K.evaluateMap;
  em.setConstants(
      {
        x0: -30.0, dx: 60.0 / NX,
        y0: -30.0, dy: 60.0 / NY,
        NX: NX,
        NY: NY,
        P: Parties.length,
        R: Ridings.length,
        N: N
      });
  em.setOutput([NX, NY, Parties.length]);
  const PV = EKP(PopularVotes);
  (Res = DKP(K.evaluateMap(
    //[5.0, 30.0, 5.0, 40.0, 20.0],
    [5.0, 30.0, 5.0, 30.0, 30.0],
    [0.0, 0.0, 0.0, -1.0, 1.0],
    [0.0, -1.0, 0.0, 1.0, 0.0],
    SlopesA,
    InterceptsA
  )));

  const render = K.render(NX, NY);
  render.setOutput([NX, NY]).setGraphical(true);
  K.r = render;
  const canvas = render.getCanvas();
  render(Res["Liberal"], Res["New Democratic"], Res["Conservative"]);
  document.getElementsByTagName('header')[0].appendChild(canvas);

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
    const results = DKR(DVP(Array.from(c)));
    //Res = results;
    console.log(results);
    console.log(_.mapValues("length", _.groupBy(_.identity, _.values(Res))));
  }
}

$.when.apply(this, files.map(function(name) {
	return $.getJSON("data/"+name+".json", function(res) { Data[name] = res; });
})).then(start);
