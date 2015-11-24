var fs = require('fs')
  , multer = require('multer')
  , log = require('nodeutil').simplelog
  , module_opts = {}
	, sep = require('path').sep
	, mime = require('mime')
	, auth = require('google-api-utility')
  , request = auth.request
  , util = require('util')
  , fs = require('fs')
  , mkdirp = require('mkdirp')
  , checker = require('./lib/checker');

//Default log level to debug
console.log('Using LOG_LEVEL=', process.env.LOG_LEVEL);
log.setLevel(process.env.LOG_LEVEL || 'DEBUG');

exports.auth = function(opts) {
	if(!opts) throw "no auth configured...";
	if(!opts.projectId) throw "no project id....";
	if(!opts.keyFilename) throw "np keyFilename...";

  module_opts = opts;
	auth.init({
	  scope: 
	  	['https://www.googleapis.com/auth/devstorage.full_control',
	  		'https://www.googleapis.com/auth/devstorage.read_write',
	  		'https://www.googleapis.com/auth/cloud-platform'].join(' '),
	  json_file: opts.keyFilename
	});
}

exports.init = function(opts) {
	if(opts && !opts['onFileUploadComplete']) {
    opts['onFileUploadComplete'] = function(file, req, res) {
			if(module_opts.bucket) {
				log.trace('Saving data to google cloud storage...');
				uploadGcs(module_opts.bucket, 
						module_opts.rootdir + sep + file.path, 
						module_opts.keep_filename ? file.originalname : file.name,
						function(e,r,d){
						  if(e) log.error('upload GCS error: ', e);
							log.trace('upload file to GCS success: ', d);

							//Rename file process
							if(module_opts.keep_filename) {
								log.trace('try to rename local filename from %s to %s',
										module_opts.rootdir + module_opts.upload_url + sep + file.name,
										module_opts.rootdir + module_opts.upload_url + sep + file.originalname);

								fs.rename(module_opts.rootdir + module_opts.upload_url + sep + file.name, 
									module_opts.rootdir + module_opts.upload_url + sep + file.originalname, 
									function(err){
											if(err) log.error('rename file error:', err);
								});
							}
						}
					);

				
			}
		}
	}
  return (multer(opts));
}

exports.downloadproxy = function(req, res, next) {
	var path = req.originalUrl;
	var patharr = path.split('/');
	patharr.shift();
	patharr.shift()
	urlpath = patharr.join('/');
	path = patharr.join(sep);

	req.params.id = path;
	log.trace('Download proxy: ', req.params.id);

	var filepath = module_opts.rootdir + module_opts.upload_url + sep + req.params.id;
	log.trace('File path will be:', filepath);

  if(req.params.id) {
		//If CDN setting is true, using CDN directly
    if(module_opts.cdn_url) {
			log.trace('response from cdn url: ', module_opts.cdn_url + sep + req.params.id);
      return res.redirect(module_opts.cdn_url + sep + req.params.id);
	  }

	  log.trace('Checking file exist of not: %s, result:%s', 
			filepath,
			fs.existsSync(filepath));

		//If local file exist, using local response
		//if(fs.existsSync(module_opts.rootdir + module_opts.upload_url + sep + req.params.id)) {
		if(fs.existsSync(filepath)) {
			log.trace('Using local file: %s', filepath); //module_opts.rootdir + module_opts.upload_url + sep + req.params.id);
		  var fileStream = fs.createReadStream(filepath); //module_opts.rootdir + module_opts.upload_url + sep + req.params.id);
			fileStream.pipe(res);
		} 
		
		//If no CDN, no local, then use GCS for response
		else {
			log.trace('Download gcs path -> gs://%s/%s', module_opts.bucket, urlpath);

			getDownloadInfo(module_opts.bucket, encodeURIComponent(urlpath), function(e,r,d){
				// if(module_opts.cache) {
					log.trace('Try to cache file to %s', filepath);

					if(e) {
						log.error('Get metadata error:', e);
					}

					log.trace("got result:", d);
					log.trace("got result type:", typeof(d));

					if(!d) {
						log.info('do sent...');
						return res.status(404).send({"code": 404, "msg": "file not found"});
					} 

					if(typeof(d) != 'object') d = JSON.parse(d);

					log.info('do else...d=', d);

					if(!d['mediaLink']) {
						log.error("response api not correct, d=", d);
						return res.status(404).send({"code": 404, "msg": "response api not correct"});
					}

					//Checking and create path folder
					var tmpArr = filepath.split(sep);
					tmpArr.pop()
					var fpath = tmpArr.join(sep);
					log.trace('mkdir for %s', fpath);
					mkdirp.sync(fpath);

				  //Download from GCS and also sync to folder	
					auth.getRequest({
						url: d.mediaLink,
						method: 'GET'
					},
					function(request){
						log.trace('Start to process download and response....');
						request.pipe(res);

						//TODO: trigger to another process, check file complete before download
						//TODO: do checksum, then move file to path
						var tmpFolder = module_opts['tmpFolder'];
						// mkdirp.sync(tmpFolder);
						// log.trace('creating tmp folder:', tmpFolder);

						var tmpFile = tmpFolder + sep + req.params.id;
						var tmpArr = tmpFile.split(sep);
						tmpArr.pop();
						var tfpath = tmpArr.join(sep);
						log.trace('mkdir for %s', tfpath);
						mkdirp.sync(tfpath);

						log.trace('tmpFile is:', tmpFile);
						
						if( tmpFolder ) {
							log.trace("write file to tmp folder...");
							
							//Step1: Clear file fist
							log.trace("cleaning tmpFile: ", tmpFile);
							if(fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);

							//Step2: Response to client & Write to tmp folder
							log.trace("write request to file...");

							//Step2-1: Response to client
							request.pipe(fs.createWriteStream(tmpFile));

							//Step2-2: Write to tmp folder
							if(module_opts.cache) 
							request.on('end', function(){
							  log.trace('Create file:%s end....', tmpFile);
								//Step3: Chekcsum and move to real path
								checker.md5hash(tmpFile, function(err, md5){
									log.trace("file:%s, md5:%s", tmpFile, md5);
									if(err) 
										log.error("checking file (%s) with md5 error...", tmpFile);
									else
										if(md5 == d['md5Hash']) { //checksum success
											log.trace('md5 create success, move file from %s to %s', tmpFile, filepath);
											fs.renameSync(tmpFile, filepath);
										} else { //error process, delete the tmp file when checksum error
											log.trace('md5 check error, will delete tmp file:%s', tmpFile);
											//fs.unlink(tmpFile);
										}
								});
							});

						} else {
							log.trace("directly response...");
							request.pipe(fs.createWriteStream(filepath));
						}

					});
					
				// }
			});
			
		}
	} else {
    res.status(404).send('file not found!');
	}
}

function uploadGcs(bucket, filepath, finalname, callback) {
	log.trace('Upload info: bucket=%s, filepath=%s, finalname=%s', bucket, filepath, finalname);
  request({
		url: util.format('https://www.googleapis.com/upload/storage/v1/b/%s/o', bucket),
	  method: 'POST',
	  preambleCRLF: true,
	  postambleCRLF: true,
	  multipart: [
	    { 'Content-Type':'application/json', body: JSON.stringify({name: finalname}) },
	    { 'Content-Type': mime.lookup(filepath), body: fs.readFileSync(filepath) }
	  ]
	}, callback);
}

function getDownloadInfo(bucket, filename, callback) {
	log.trace('Get from GCS bucket:%s, filename:%s', bucket, filename);
  var downloadUrl = 'https://www.googleapis.com/storage/v1/b/%s/o/%s';
	request({
		url: util.format(downloadUrl, bucket, filename),
		method: 'GET'
	}, callback);
}
