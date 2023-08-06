const express = require('express');

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const app = express();
const port = 5000;
const phoneNumbers = {};
const socialMediaLinks = {};
const allUrls = new Set();

const websitesList = './sample-websites.csv';
const websitesListWithInfo = './sample-websites-company-names.csv'
const data = [];
const dataWithInfo = [];

const { Client } = require('elasticsearch');

const client = new Client({
  node: 'http://localhost:9200', 
});

const indexName = 'veridion';

/*const csvWriter = createCsvWriter({
  path: 'output.csv', 
  header: [
    { id: 'domain', title: 'domain' },
    { id: 'company_commercial_name', title: 'company_commercial_name' },
    { id: 'company_legal_name', title: 'company_legal_name'},
    { id: 'company_all_available_names', title: 'company_all_available_names'},
    { id: 'phone_numbers', title: 'phone_numbers'}
  ]
});*/

//read the links from csv
fs.createReadStream(websitesList)
  .pipe(csv())
  .on('data', (row) => {
  	let newRow = 'https://' + row.domain
    data.push(newRow);
  })
  .on('end', () => {
    //console.log('CSV data:', data);
  });

//function for social Media Link verification
function isSocialMediaLink(url) {
  return /twitter\.com|facebook\.com|instagram\.com/.test(url);
}

//this function is crawling the phonenumbers by a regex and the social links by the name found in the href
//the idea behind the depth is that for every link is trying to find 9 more and crawl them, so for every starting point, I will have 10 links crawled
async function crawlForPhoneNumbers(urls, depth, originalUrl){
  	for(const url of urls){
  		let depthUrl = depth;
  	    console.log(url); 
  	    allUrls.add(url);
  	    try {
  	   		const response = await axios.get(url);
    		const html = response.data;

    		const $ = cheerio.load(html);


    		const phoneNumberRegex = /(\+\d{1,2}\s?)?(\(\d{3}\)|\d{3})([-\s])?\d{3}([-.\s])?\d{4}/g;

    		const hrefs = [];
    		let matches = [];

    		$('body').each(async (index, element) => {
      			const text = $(element).text();
      			matches = text.match(phoneNumberRegex);

      			$('a').each((index, element) => {
      				const href = $(element).attr('href');
      				if (href && !allUrls.has(href) && (href.startsWith('https') || href.startsWith('http'))  && !isSocialMediaLink(href) && depthUrl < 10) {
        				hrefs.push(href);
        				depthUrl = depthUrl + 1;
      				}
    			});
      			
      		});
    		if(originalUrl == null){
    			originalUrl = url;
    		}
    		if (matches) {
        		phoneNumbers[originalUrl] = matches;
      		}
      		for(href of hrefs){
      			if(href && isSocialMediaLink(href)){
        			socialMediaLinks[originalUrl] = href;
        		}
      		}
      		if(hrefs && depth < 10){
      			await crawlForPhoneNumbers(hrefs, depthUrl, originalUrl);
      		}

  		} catch (error) {
    		console.error('Error crawling:', error.message);
  		}
	}
}

app.listen(port, () => {
    console.log(`Now listening on port ${port}`);
}); 

//the EP for crawling and indexing with ElasticSearch
app.get('/crawl', async function (req, res) {
  res.send('GET request to homepage');

  try{
  	const testData = [];
  	testData.push(data[0])
  	const urlToCrawl = testData;
  	console.log(data[0]);
  	await crawlForPhoneNumbers(urlToCrawl, 0, null);

  	 fs.createReadStream(websitesListWithInfo)
       .pipe(csv())
       .on('data', async (row) => {
       	 row.phone_numbers = '';
       	 if(phoneNumbers[row.domain]){
  	     	row.phone_numbers = phoneNumbers[row.domain];
  	     }
  	     dataWithInfo.push(row);
  	      await client.index({
    			index: indexName,
    			document: {
     				domain: row.domain,
      				company_commercial_name: row.company_commercial_name,
      				company_legal_name: row.company_legal_name,
      				company_all_available_names: row.company_all_available_names,
      				phone_numbers: row.phone_numbers
   				}
  			});
       })
       .on('end', () => {
         /*csvWriter.writeRecords(dataWithInfo)
  			.then(() => {
    			console.log('CSV file written successfully.');
  			})
  			.catch((error) => {
    			console.error('Error writing CSV file:', error);
  			});*/

       });
	
	console.log(phoneNumbers);
	console.log(socialMediaLinks);
  }catch(error){

  }
})

//the EP that is taking 2 possible params, phone numbers and domain, and search by them
app.get('/search', async function (req, res) {
	const { domain, phoneNumber } = req.query;
	if(domain){
		const result = await client.search({
    		index: indexName,
    		body: {
        		query: {
          			match: {
            			domain: domain 
          			}
        		}
      		}
  		});
  		console.log(result);
	}

	if(phoneNumber){
		const result = await client.search({
    		index: indexName,
    		body: {
        		query: {
          			match: {
            			phone_numbers: phoneNumber 
          			}
        		}
      		}
  		});
  		console.log(result);
	}



})

