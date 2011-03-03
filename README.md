Sextant
-------

A sextant is an instrument used to measure the angle between any two visible objects.

**Version:** 0.4 

If you know what this is, then you know what this is. Unfortunately I can't give you much more to go on other than it can be used to navigate the open seas by measuring the angle (or position as it maybe) of two visible objects (say a target and a reality). Figure it out from there.

    Yo ho, yo ho, a pirate's life for me. 
    We pillage plunder, we rifle and loot. 
    Drink up me 'earties, yo ho. 
    We kidnap and ravage and don't give a hoot. 
    Drink up me 'earties, yo ho.

[Can the seas be tamed?](http://arewefirstyet.com)

Genesis of this project: [community.js](http://jsconf.eu/2010/communityjs_by_chris_williams_1.html)

**NOTE** This code base has been updated to use node.js v. 0.4.x. It only requires that [express](http://expressjs.com/) be installed. You will also need a [CouchDB instance](http://www.couchone.com/) to store all your data. Be sure to update the config.js file with appropriate settings and most importantly, update the targets.js file with what you want Sextant to track.

One note, you need to use the power of cron, something to the effect of:

    5 1 * * * curl http://127.0.0.1/seek > /dev/null

Good travels to you!
