/*==============================================================================
(C) Copyright 2019,2020,2021 John J Kauflin, All rights reserved. 
-----------------------------------------------------------------------------
DESCRIPTION: NodeJS server to run console utilies for the web site
-----------------------------------------------------------------------------
Modification History
2019-02-11 JJK  Initial version
2020-07-07 JJK  Modified to work with new MediaGallery and createThumbnails
                which takes "subPath" as a parameter
2021-05-09 JJK  Re-factored for MediaGallery-Admin
                Working on FTP functions
2021-05-23 JJK  
=============================================================================*/

// General handler for any uncaught exceptions
process.on('uncaughtException', function (e) {
    console.log("UncaughtException, error = " + e);
    console.error(e.stack);
    // Stop the process
    process.exit(1);
});

// Read environment variables from the .env file
require('dotenv').config();

const https = require('https');
var dateTime = require('node-datetime');
var ftp = require('ftp');
var fs = require('fs');

// List all files in a directory in Node.js recursively in a synchronous fashion
var walkSync = function (dir, filelist) {
    var path = path || require('path');
    var fs = fs || require('fs'),
    files = fs.readdirSync(dir);
    filelist = filelist || [];
    files.forEach(function (file) {
        if (fs.statSync(path.join(dir, file)).isDirectory()) {
            filelist = walkSync(path.join(dir, file), filelist);
        }
        else {
            // check for image file first???
            filelist.push(path.join(dir, file));
        }
    });
    return filelist;
};

var fileList = walkSync(process.env.PHOTOS_DIR+process.env.PHOTOS_DIR);
for (var i = 0, len = fileList.length; i < len; i++) {
    console.log("fileList[" + i + "] = " + fileList[i]);
}

var backSlashRegExp = new RegExp("\\\\", "g");

var ftpClient = new ftp();
ftpClient.connect({
    host: process.env.FTP_HOST,
    port: process.env.FTP_PORT,
    user: process.env.FTP_USER,
    password: process.env.FTP_PASS
});

ftpClient.on('ready', function () {
    console.log("connected");

    /*
    ftpClient.list(process.env.REMOTE_PATH, false, function (error, dirlist) {
        console.log("dirlist len = " + dirlist.length);
        dirlist.forEach(function (dl) {
            console.log("name = " + dl.name);
        });
    });

    ftpClient.put('foo.txt', process.env.REMOTE_PATH+'foo.txt', function (err) {
        if (err) throw err;
        ftpClient.end();
    });
    */

});


// Start recursive function
//createThumbnail(0);

function createThumbnail(index) {
    var fileNameAndPath = fileList[index].substring(3).replace(backSlashRegExp, "/");
    var tempStr = fileNameAndPath.replace("jjkPhotos", "Photos");
    fileNameAndPath = tempStr;
    var tempUrl = process.env.WEB_ROOT_URL + '/vendor/jkauflin/jjkgallery/createThumbnail.php?filePath=' + fileNameAndPath;
    
    console.log("tempUrl = " + tempUrl);

    // Test FTP functions

    /*
    https.get(tempUrl, (resp) => {
        let data = '';
        // A chunk of data has been recieved.
        resp.on('data', (chunk) => {
            data += chunk;
        });
        // The whole response has been received. Print out the result.
        resp.on('end', () => {
            //console.log("data = " + data);
            // Maybe return if it created one or not?  and do less time if not created
            console.log(dateTime.create().format('Y-m-d H:M:S ') + index + " of " + fileList.length + ", " + fileNameAndPath + ", " + data);
            var delayMs = 50;
            if (data == 'Created') {
                delayMs = 100;
            }
            if (index < fileList.length - 1) {
                setTimeout(createThumbnail, delayMs, index + 1);
            }
        });
    }).on("error", (e) => {
        console.log("Error: " + e.message);
        // Wait X seconds and try the same one again
        setTimeout(createThumbnail, 3000, index);
        //Error: connect ETIMEDOUT 173.205.127.190:443
    });
    */

} // function createThumbnail(fileNameAndPath) {


