var sys = require("sys");
var connect = require("connect");
var express = require("express");
var fs = require("fs");
var http = require("http");
var target_queries = require("./targets");

cport = process.env.COUCHDB_PORT || 5984;
chost = process.env.COUCHDB_HOST || "localhost";
cuser = process.env.COUCHDB_USER;
cpass = process.env.COUCHDB_PASSWORD;

debug = process.env.DEBUG;
// sys.puts("Connecting to "+cuser+"|"+cpass+"|"+chost+"|"+cport);

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



var is_first = 0;
var active_series = [];
var resetting = false;

function find_url_for_label(label) {
    var found = null;
    target_queries.forEach(function(elem, idx) {
        if (elem.name === label) {
            found = elem.url;
        }
    });
    return found;
}


var target_url = "/ajax/services/search/web?v=1.0&q={QUERY}&start={PAGE}"
var MAX_PAGES = 10;
var MAX_SPIN = 50;

var user_agents = [
    "Mozilla/5.0 (Windows; U; Windows NT 5.1; en-US) AppleWebKit/525.13 (KHTML, like Gecko) Chrome/0.A.B.C Safari/525.13",
    "Mozilla/5.0 (Windows; U; Windows NT 5.2; en-US) AppleWebKit/533.17.8 (KHTML, like Gecko) Version/5.0.1 Safari/533.17.8",
    "Mozilla/5.0 (Windows; U; Windows NT 6.1; ja-JP) AppleWebKit/533.16 (KHTML, like Gecko) Version/5.0 Safari/533.16",
    "Mozilla/5.0 (Windows; U; Windows NT 6.1; en-US) AppleWebKit/534.10 (KHTML, like Gecko) Chrome/7.0.540.0 Safari/534.10",
    "Mozilla/5.0 (Windows; U; Windows NT 5.2; en-US) AppleWebKit/534.10 (KHTML, like Gecko) Chrome/7.0.540.0 Safari/534.10",
    "Mozilla/5.0 (Windows; U; Windows NT 5.1; en-US) AppleWebKit/534.9 (KHTML, like Gecko) Chrome/7.0.531.0 Safari/534.9",
    "Mozilla/5.0 (Windows; U; Windows NT 5.2; en-US) AppleWebKit/534.4 (KHTML, like Gecko) Chrome/6.0.481.0 Safari/534.4",
    "Mozilla/5.0 (X11; U; Linux i686; en-US) AppleWebKit/534.3 (KHTML, like Gecko) Chrome/6.0.462.0 Safari/534.3"
];


function seek (target_url, page, is_found, callback) {
    var ua = user_agents[Math.floor(Math.random()*user_agents.length)];
    var paged_target_url = target_url.replace("{PAGE}", page);
    var google = http.createClient(80, "ajax.googleapis.com");
    var request = google.request('GET', 
                                 paged_target_url,
                                 {
                                     "Host": "ajax.googleapis.com",
                                     "User-Agent": ua
                                 });
    if (debug)
      console.log("Requesting "+paged_target_url);
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
                        // urls.push({url: bit.url, name: bit.titleNoFormatting})
                    }
                    if (found_index == -1) {
                        // urls.push({url: bit.url, name: bit.titleNoFormatting})
                    }
                });
                
                if (page == MAX_SPIN) {
                    callback(MAX_SPIN*4);
                } else if (found_index >= 0)
                    callback(found_index+1);
                else {
                    seek(target_url, page+1, is_found, callback);
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
    is_first = 0;
    resetting = true;
    active_series.length = 0;  
    db.view("ordering", "byid", {}, function (err, r) {
        if (err) { 
            for (var e in err) { sys.puts(""+e+": "+err[e]) }
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
                        if (curry_data[curry_data.length-1][1] == 1) { is_first += 1; }
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
                if (curry_data[curry_data.length-1][1] == 1) { is_first += 1; }
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
        
        var callback = (function (t) {
            return (function (found_index) {
                var timestamp = ""+nao.getFullYear()+pad(nao.getUTCMonth())+pad(nao.getUTCDate());
                db.saveDoc(keyify(t)+":"+timestamp, {"target": t.name, "query": t.query, "date": timestamp, "placement": found_index}, function (err, doc) {
                    if (err) { 
                      console.log(JSON.stringify(err)) 
                    }
                });
                idx += 1;
            });
        })(target);
        seek(target_url.replace("{QUERY}", target.query), 0, function(val) {
            return (val.indexOf(target.target) >= 0);
        }, callback);
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
    var current_rankings = [];
    for (var idx in active_series)   {
        rankings = active_series[idx].data;
        current_rankings.push({ label: active_series[idx].label, ranking: rankings[rankings.length-1][1], url: find_url_for_label(active_series[idx].label) });
    }
    res.render("index.ejs", { locals: {
        data: JSON.stringify(active_series),
        first: f,
        rankings: current_rankings
    }});
})


app.listen(process.env.NODE_PORT || 80);