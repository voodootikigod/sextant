var sys = require("sys");
var connect = require("connect");
var express = require("express");
var fs = require("fs");
var http = require("http");

cport = process.env.COUCHDB_PORT || 5984;
chost = process.env.COUCHDB_HOST || "localhost";
cuser = process.env.COUCHDB_USER;
cpass = process.env.COUCHDB_PASSWORD;
sys.puts("Connecting to "+cuser+"|"+cpass+"|"+chost+"|"+cport);

if (cuser) {
  var couchdb = require("couchdb").createClient(cport, chost, cuser, cpass);
} else {
  var couchdb = require("couchdb").createClient(cport, chost);
}
var db = couchdb.db("arewefirstyet");

var pub = __dirname + '/public';
var app = express.createServer(
    express.staticProvider(pub)
);

app.set('views', __dirname + '/views');


var target_queries = [
    {name: "Learn JavaScript", query: "Learn%20JavaScript", target: "developer.mozilla.org"},
    {name: "JS Reference", query: "JS%20Reference", target: "developer.mozilla.org"},
    {name: "Learn JS", query: "Learn%20JS", target: "developer.mozilla.org"},
    {name: "JS Array", query: "JS%20Array", target: "developer.mozilla.org"},
    {name: "JS String", query: "JS%20String", target: "developer.mozilla.org"},
    {name: "JS Number", query: "JS%20Number", target: "developer.mozilla.org"},
    {name: "JS RegExp", query: "JS%20RegExp", target: "developer.mozilla.org"},
    {name: "JS Function", query: "JS%20Function", target: "developer.mozilla.org"},
    {name: "JS Tutorial", query: "JS%20Tutorial", target: "developer.mozilla.org"},
    {name: "JS Documentation", query: "JS%20Documentation", target: "developer.mozilla.org"}
];

var is_first = 0;
var active_series = [];
var resetting = false;


var target_url = "/ajax/services/search/web?v=1.0&q={QUERY}&start={PAGE}"
var MAX_PAGES = 10;
var MAX_SPIN = 50;
function seek (target_url, page, is_found, urls, callback) {
    var paged_target_url = target_url.replace("{PAGE}", page);
    var google = http.createClient(80, "ajax.googleapis.com");
    var request = google.request('GET', 
                                 paged_target_url,
                                 {
                                     "Host": "ajax.googleapis.com",
                                     "User-Agent": "Mozilla/5.0 (Windows; U; Windows NT 5.1; en-US) AppleWebKit/525.13 (KHTML, like Gecko) Chrome/0.A.B.C Safari/525.13"
                                 });
    request.end();
    request.on("response", function (response) {
        var body = "";
        response.on("data", function(chunker) {
            body += chunker;
        });
        response.on("end", function() { 
            var data = JSON.parse(body);
            if (data.responseData) {
              var juicybits = data.responseData.results;
              var found_index = -1;
              juicybits.forEach(function(bit, bitcount) {
                if (is_found(bit.url)) {
                  found_index = page*4 + bitcount;
                  urls.push({url: bit.url, name: bit.titleNoFormatting})
                }
                if (found_index == -1) {
                  urls.push({url: bit.url, name: bit.titleNoFormatting})
                }
              });
            
              if (page == MAX_SPIN) {
                callback(MAX_SPIN*4, urls);
              } else if (found_index >= 0)
                callback(found_index+1, urls);
              else {
                seek(target_url, page+1, is_found, urls, callback);
              }
            } else {
              sys.p("Failure on "+paged_target_url);
            }
        });
	       
    });
}

function pad(n){return n<10 ? '0'+n : n}
function keyify(i) {  return i.name.toLowerCase().replace(/[^a-z0-9]/g,""); }
function reset_active_series() {
  resetting = true;
  active_series.length = 0;  
  db.view("ordering", "byid", {}, function (err, r) {
    if (err) { 
      for (var e in err) { sys.puts(""+e+": "+err[e]) }
      sys.puts(r);
      resetting = false;
    } else {
      var current_target_count = 0;
      var previous_target = null;
      var curry_data = [];
      var curry_label = "";
      r.rows.forEach(function (elem, idx) {
        var current = elem.value
        if (current._id.split(":")[0] != previous_target) {
          if (previous_target) {
            if (curry_data[curry_data.length-1] == 0) { is_first += 1; }
            active_series.push({
              label: curry_label,
              data: JSON.parse(JSON.stringify(curry_data))
            })
          }
          current_target_count = 0;
          curry_data.length = 0;
          previous_target = current._id.split(":")[0];
          curry_label = current.target;
        }
        if (current_target_count < 20) {
          var d = (new Date(Date.UTC(parseInt(current.date.slice(0,4), 10), parseInt(current.date.slice(4,6), 10), parseInt(current.date.slice(6,8), 10), 0, 0, 0, 0))).getTime();
          curry_data.push([d, current.placement]);
          current_target_count += 1;
        }
      });
    
      if (previous_target) {
        if (curry_data[curry_data.length-1] == 0) { is_first += 1; }
        active_series.push({
          label: curry_label,
          data: curry_data
        })
      }
      resetting = false;
    }
  })
}

function query_placement() {
  var nao = (new Date());
  var idx = 0;
  target_queries.forEach(function(target, idx) {
    var results = [];
   
    var callback = (function (t) {
      return (function (found_index, urls) {
        var timestamp = ""+nao.getFullYear()+pad(nao.getUTCMonth())+pad(nao.getUTCDate());
        db.saveDoc(keyify(t)+":"+timestamp, {"target": t.name, "query": t.query, "date": timestamp, "placement": found_index, "rankings": urls}, function (err, doc) {
            if (err) { throw new Error(JSON.stringify(err)) }
        });
        idx += 1;
        if (idx == target_queries.length)  {
          reset_active_series();
        }
      });
    })(target);
    seek(target_url.replace("{QUERY}", target.query), 0, function(val) {
      return (val.indexOf(target.target) >= 0);
    }, [], callback);
  });
}    



// reset on boot;
reset_active_series();


app.get("/reset", function (req, res) {
  reset_active_series();
  res.send("OK");
})

app.get("/seek", function(req, res) {
    query_placement();
    res.render("seek.ejs");
});

app.get("/", function (req, res) {
  var f = (is_first > (active_series.length/2) ? "Yes" : "No");
  f += " ("+is_first+")"
  res.render("index.ejs", { locals: {
    data: JSON.stringify(active_series),
    first: f
  }});
})


app.listen(process.env.NODE_PORT || 80);