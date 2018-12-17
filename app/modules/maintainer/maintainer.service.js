'use strict';

const Constants = require( '../../common/constants' );
const Request = require( 'request' );
const fs = require( 'fs' );
const url = require( 'url' );
const Feed = require( 'rss-to-json' );

const noImage = Constants.defaults.noImagePath;

const MaintainerService = ( () => {

    /**
     * public
     * @param language
     * @param category
     * @param itemCount
     * @returns {Promise}
     */
    function newsFeed( language, category, itemCount ) {
        return new Promise( function ( resolve ) {

            switch ( language ) {
                case Constants.languages.hu_HU: {
                    getNewsHu( category ).then(
                        async response => resolve( buildArticleList( response, category, itemCount ) ),
                        err => resolve( err )
                    );
                    break;
                }
                case Constants.languages.en_GB: {
                    getNewsEn( category ).then(
                        async response => resolve( buildArticleList( response, category, itemCount ) ),
                        err => resolve( err )
                    );
                    break;
                }
            }


        } );
    }

    async function buildArticleList( articles, category, itemCount ) {
        let articleList = [];
        if ( !itemCount && articles.articles ) {
            itemCount = articles.articles.length;
        }
        if ( articles && articles.hasOwnProperty( 'articles' ) ) {
            await Promise.all( articles.articles.map( async item => {
                await imageHandler( item, category ).then( newItem => {
                    item = newItem;
                    if ( item.title && articleList.length <= itemCount ) {
                        articleList.push( item );
                    }
                } );
            } ) );

            return { articles: articleList };
        } else {
            return false;
        }
    }

    /**
     *
     * @param category
     * @returns {Promise}
     */
    function getNewsEn( category ) {
        return new Promise( function ( resolve ) {

            const options = {
                url: Constants.newsApi.apiUrl, qs: {
                    source: Constants.sourceListEn[ category ].source,
                    sortBy: Constants.sourceListEn[ category ].sortBy,
                    apiKey: Constants.newsApi.apiKey
                },
                timeout: 5000
            };

            function callback( error, response, body ) {
                if ( !error && response.statusCode == 200 ) {
                    resolve( JSON.parse( body ) );
                } else {
                    resolve( { articles: {} } );
                }
            }

            Request( options, callback );
        } );
    }


    /**
     *
     * @param category
     * @returns {Promise}
     */
    function getNewsHu( category ) {
        return new Promise( function ( resolve ) {
            Feed.load( Constants.sourceListHu[ category ].source, function ( err, rss ) {
                if ( !err ) {
                    resolve( convertFeed( rss ) );
                }
            } );
        } );
    }

    function convertFeed( jsonFeed ) {
        let articles = [];

        const getImageUrl = ( enclosures ) => {
            for ( let akey in enclosures ) {
                if ( enclosures.hasOwnProperty( akey ) && !enclosures[ akey + 1 ] ) {
                    return enclosures[ akey ].url;
                }
            }
        };

        for ( let key in jsonFeed.items ) {
            if ( jsonFeed.items.hasOwnProperty( key ) ) {
                let item = jsonFeed.items[ key ];
                let complete = true;
                let createdDate, isoDate, imageUrl;

                /**
                 * @param {{created:string}} item
                 */
                if ( !item.hasOwnProperty( 'title' ) ) {
                    complete = false;
                }

                if ( item.hasOwnProperty( 'created' ) ) {
                    createdDate = new Date( item.created );
                    isoDate = createdDate.toISOString();
                } else {
                    complete = false;
                }

                if ( item.hasOwnProperty( 'description' ) && typeof item.description === 'string' ) {
                    //remove html content
                    item.description = item.description.replace( /<(.*?)\/>/g, '' ).replace( /<(.*?)\/>/g, '' );
                }

                /**
                 * @param {{enclosures:string}} item
                 */
                if ( item.hasOwnProperty( 'enclosures' ) ) {
                    imageUrl = getImageUrl( item.enclosures );
                }

                if ( complete ) {
                    articles[ articles.length ] = {
                        title: item.title,
                        description: item.description,
                        url: item.url,
                        urlToImage: imageUrl,
                        publishedAt: isoDate
                    };
                }
            }
        }

        return { articles: articles };
    }


    /**
     *
     * @param item
     * @param category
     * @returns {Promise}
     */
    function imageHandler( item, category ) {
        return new Promise( function ( resolve ) {
            if ( item.urlToImage && category ) {
                let localImage = getPathFromUrl( item.urlToImage.substring( item.urlToImage.lastIndexOf( '/' ) + 1 ) );

                //check blacklist
                for ( let blacklistedImage in Constants.newsApi.blacklist ) {
                    if ( item.urlToImage.indexOf( Constants.newsApi.blacklist[ blacklistedImage ] ) !== -1 ) {
                        item.urlToImage = noImage;
                        resolve( item );
                        return;
                    }
                }

                /**
                 * check if image is already downloaded
                 * @param {{existsSync:function}} item
                 */

                if ( fs.existsSync( Constants.defaults.imageAbsPath + localImage ) ) {
                    item.urlToImage = ( getFilesizeInBytes( Constants.defaults.imageAbsPath + localImage ) > 1000 ) ? Constants.defaults.imageRelPath + localImage : noImage;
                    resolve( item );
                } else {
                    //save the image and load the local one... if everything went well... otherwise load the default placeholder image
                    saveNews( item.urlToImage ).then( function ( uploadResult ) {
                            item.urlToImage = ( fs.existsSync( Constants.defaults.imageAbsPath + localImage ) && uploadResult.statusCode === 200 && ( getFilesizeInBytes( Constants.defaults.imageAbsPath + localImage ) > 1000 ) ) ? Constants.defaults.imageRelPath + localImage : noImage;
                            resolve( item );
                        }, function () {
                            item.urlToImage = noImage;
                            resolve( item );
                        }
                    );
                }
            } else {
                //broken response or feed
                item.urlToImage = noImage;
                resolve( item );
            }
        } );
    }

    /**
     *
     * @param fileUrl
     * @returns {Promise}
     */
    function saveNews( fileUrl ) {
        /**
         *
         * @param uri
         * @param filename
         * @param callback
         * @returns {*}
         */
        let download = function ( uri, filename, callback ) {
            try {
                /**
                 * @param {{createWriteStream:function}} fs
                 */
                if ( filename && filename.match( /(.jpg|.jpeg|.png|.gif|.bmp)/ ) ) {
                    let fstream = fs.createWriteStream( filename );
                    Request.head( uri, function ( e, res ) {
                        Request( uri ).pipe( fstream )
                            .on( 'close', callback )
                            .on( 'error', function () {
                                fstream.on( 'error', function ( e ) {
                                    console.log( 'ERROR:' + e );
                                    res.status( 200 ).send( e.errorMessage );
                                } );
                            } );
                    } );
                } else {
                    return Constants.defaults.noImagePath;
                }
            } catch ( err ) {
                return fileName;
            }
        };

        let URL = url.parse( fileUrl );
        let fileName = URL.pathname.substring( URL.pathname.lastIndexOf( '/' ) + 1 ).replace( /((\?|#).*)?$/, '' );

        return new Promise( function ( resolve ) {
            download( fileUrl, Constants.defaults.imageAbsPath + fileName, ( err ) => {
                resolve( err ? err : { statusCode: 200 } );
            } );
        } );
    }

    /**
     *
     * @param url
     * @returns {*}
     */
    function getPathFromUrl( url ) {
        return url.split( /[?#]/ )[ 0 ];
    }

    /**
     * @param filename
     */
    function getFilesizeInBytes( filename ) {
        /**
         * @param {{statSync:function}} fs
         */
        return fs.statSync( filename )[ 'size' ];
    }

    return {
        newsFeed: newsFeed
    };
} )();

module.exports = MaintainerService;
