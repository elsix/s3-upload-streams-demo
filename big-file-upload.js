#!/usr/bin/env node

'use strict';

let argv = require('yargs').argv;
let fs = require('fs');
let aws = require('aws-sdk');
let _ = require('lodash');
let Uploader = require('s3-upload-streams');

let filename = argv.file;
let destKey = argv.destKey;
let bucket = argv.awsBucket;
let accessKeyId = argv.awsAccessKeyId;
let accessKeySecret = argv.awsAccessKeySecret;
let partsPerUploader = argv.partsPerUploader || 2;
let partSize = argv.awsPartSize || 5242880; //eslint-disable-line no-inline-comments 5MB
let maxConcurentUploads = argv.concurentUploads || 10;
let ssl = !(argv.awsDisableSsl || false);
// Starting part offset fot this uploader. Amazon works perfect if part numbers are not concecutive numbers.
let uploaderOffset = argv.uploaderOffset || partsPerUploader;

let startUpload = () => {
  let s3 = new aws.S3({
    accessKeyId: accessKeyId,
    secretAccessKey: accessKeySecret,
    sslEnabled: ssl
  });

  let s3Uploader = new Uploader(s3, bucket, partSize, maxConcurentUploads);
  let idPromise = s3Uploader.startUpload(
    { Key: destKey },
    null,
    { }
  );

  return idPromise.then(id => s3Uploader.awsUploadId(id));
};

let preparePartUploader = (start, end, partialUploadParams) => {
  return new Promise(resolve => {
    let s3 = new aws.S3({
      accessKeyId: accessKeyId,
      secretAccessKey: accessKeySecret,
      sslEnabled: true
    });

    let stream = fs.createReadStream(filename, { start: start, end: end });
    let s3Uploader = new Uploader(s3, bucket, partSize, maxConcurentUploads);
    let promiseId = s3Uploader.startUpload(
      { Key: destKey },
      stream,
      { },
      partialUploadParams
    );

    stream.on('end', () => {
      promiseId.then(id => s3Uploader.awsParts(id))
      .then(parts => resolve(parts))
      .catch(err => console.log(err.stack));
    });
  });
};

let endUpload = (awsUploadId, parts) => {
  let s3 = new aws.S3({
    accessKeyId: accessKeyId,
    secretAccessKey: accessKeySecret,
    sslEnabled: true
  });

  let s3Uploader = new Uploader(s3, bucket, partSize, maxConcurentUploads);
  let idPromise = s3Uploader.startUpload(
    { Key: destKey },
    null,
    { orginalPath: filename },
    {
      UploadId: awsUploadId,
      Offset: 0,
      Parts: parts
    }
  );

  return idPromise.then(id => s3Uploader.completeUpload(id));
};

let currentOffset = 0;
let stats = fs.statSync(filename);
let awsCurrentOffset = 0;

startUpload()
.then(awsUploadId => {
  let parts = [];
  while(currentOffset < stats.size) {
    let end = stats.size < currentOffset + partsPerUploader*partSize - 1  ?
      stats.size :
      currentOffset + partsPerUploader*partSize - 1;
    parts.push(
      preparePartUploader(currentOffset, end, {
        UploadId: awsUploadId,
        Offset: awsCurrentOffset
      })
    );
    currentOffset = currentOffset + partsPerUploader*partSize;
    awsCurrentOffset += uploaderOffset;
  }

  return Promise.all(parts)
  .then(parts => endUpload(awsUploadId, _.flattenDeep(parts)))
  .then(metadata => console.log(`Uploaded ${metadata.additionalMetadata.orginalPath} to ${metadata.location}`));
})
.catch(err => console.log(err.stack));
