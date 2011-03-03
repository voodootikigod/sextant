// npm install express
// To use, be sure to add a crontab entry that every 24 hours pings the /seek path of the webserver. This will force the aggregation of new results per day.

var sys = require("sys");
var connect = require("connect");
var express = require("express");
var fs = require("fs");
var http = require("http");
var target_queries = require("./targets");
var config = require("./config");

debug = process.env.DEBUG;


function couchdb_request(obj) {
  if (!obj) { obj = {}; }
  obj.port = config.couchdb.port;
  obj.host = config.couchdb.host;
  var pathRegex = new RegExp("^\/"+config.couchdb.database+"\/")
  if (obj.path == null || obj.path == undefined) { obj.path = ""; }
  if (!pathRegex.test(obj.path))
    obj.path = ("/" + config.couchdb.database + "/" + obj.path).replace("//", "/"); //handle duplicate slashes gracefully
  if (!obj.headers) 
    obj.headers = {};
  if (!obj.headers['Content-Type']) 
    obj.headers['Content-Type'] = 'application/json'; 
  if (config.couchdb.user) 
    obj.headers["Authorization"] = 'Basic ' + new Buffer(config.couchdb.user + ':' + config.couchdb.password).toString('base64');
  if (!obj.method)
    obj.method = 'GET';
  return obj;
}


// Verify and if necessary configure CouchDB Connection
var sanity = http.get(couchdb_request(), function(res) {
  if (res.statusCode != 200) {
    sys.puts("Could not connect to CouchDB with information from config.js.");
    process.exit(-1);
  } else {
    var design_doc = {
      "_id": "_design/ordering",
      "views": {
       "byid": {
        "map" : "function(doc) {    if (doc.target) {      emit(doc._id, doc);    }    }"
       }
      }
    }
    var ddoc_req = http.request(couchdb_request({ method: "PUT", path: "_design/ordering", headers: {'Content-Type': 'application/json'} }), function (response) {
      if (response.statusCode == 201) {
        console.log("Added design document to "+config.couchdb.database);
      } else if (response.statusCode == 409) {
        // design document exists, do not update/change.
      } else {
        console.log("Design document could not be added and is not present, sextant will not work.");
        process.exit(-1);
      }
    });
    ddoc_req.write(JSON.stringify(design_doc));
    ddoc_req.end();
  }
});
sanity.end();





// Load up the server.

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


var target_url = "/ajax/services/search/web?v=1.0&q={QUERY}&start={PAGE}";




function seek (target_url, page, is_found, callback) {
  var uas =config.user_agents;
    var ua = uas[Math.floor(Math.random()*uas.length)];
    var paged_target_url = target_url.replace("{PAGE}", page);
    if (debug)
      console.log("Requesting "+paged_target_url);

    var request = http.get({ 
      host: "ajax.googleapis.com", 
      path: paged_target_url,
      headers: { "User-Agent": ua }
    }, function (response) {
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
                        // urls.push({url: bit.url, name: bit.titleNoFormatting})  -- removed due to TOS concern (no indexing)
                    }
                    if (found_index == -1) {
                        // urls.push({url: bit.url, name: bit.titleNoFormatting})  -- removed due to TOS concern (no indexing)
                    }
                });
                
                if (page == config.max_spin) {
                    callback(config.max_spin*4);
                } else if (found_index >= 0)
                    callback(found_index+1);
                else {
                    seek(target_url, page+1, is_found, callback);
                }
            } else {
                sys.puts("Failure on "+paged_target_url);
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
    
    var view = http.get(couchdb_request({ path: "_design/ordering/_view/byid", headers: {'Content-Type': 'application/json'} }), function (response) {
      if (response.statusCode != 200) {
        resetting = false;
        console.log("Did not receive data from design document");
      } else {
        var body = "";
        response.on("data", function(chunker) {
            body += chunker;
        });
        response.on("end", function() { 
            var data = JSON.parse(body);
            var current_target_count = 0;
            var previous_target = null;
            var curry_data = [];
            var curry_label = "";
            data.rows.forEach(function (elem, idx) {
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
                var d = (new Date(Date.UTC(parseInt(current.date.slice(0,4), 10), parseInt(current.date.slice(4,6), 10), parseInt(current.date.slice(6,8), 10), 0, 0, 0, 0))).getTime();
                curry_data.push([d, current.placement]);
                current_target_count += 1;
            });
            
            if (previous_target) {
                if (curry_data[curry_data.length-1][1] == 1) { is_first += 1; }
                active_series.push({
                    label: curry_label,
                    data: curry_data
                })
            }
            resetting = false;
        });
      }
    });
    view.end();
}

function query_placement() {
    var nao = (new Date());
    var idx = 0;
    target_queries.forEach(function(target, idx) {
        
        var callback = (function (t) {
            return (function (found_index) {
                var timestamp = ""+nao.getFullYear()+pad(nao.getUTCMonth())+pad(nao.getUTCDate());
                
                var doc = http.request(couchdb_request({path: keyify(t)+":"+timestamp, method: "PUT"}), function (res) {
                  if (res.statusCode != 200 || res.statusCode != 201) {
                    console.log("Could not add doc:");
                    console.log(doc);
                  }// sys.p(res);
                })
                doc.write(JSON.stringify({"target": t.name, "query": t.query, "date": timestamp, "placement": found_index}));
                doc.end();
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

// use env port value if present else config port
app.listen(process.env.NODE_PORT || config.port);