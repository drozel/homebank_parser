const fs = require('fs');
const moment = require('moment');

const lineReader = require('line-reader');

class CsvParser {
	constructor(filepath, schema) {
		this.data = {
			parse_date: new Date(),
			parser: schema.name,
			fields: null, // string fields description, from CSV header

			entries: []
			/* Entry struct:
				{
					date: Datetime,
					rawdata: string, (original data from file)

					amount: floating point (+ for income, - for expense),
					type: string, (card_payment|direct_debit|transfer|income|refund)
					company: string,
					description: string,
				}	
			*/

		}

		this.filepath = filepath;
		this.schema = schema;
	}

	parse() {
		var lineCounts = 0;

		var lines = fs.readFileSync(this.filepath, 'utf-8')
		    .split('\n')
			.filter(Boolean);
			
		if (lines.length === 0) throw `nothing read from file ${this.filepath}`;

		if (this.schema.includes_header) {
			this.data.fields = lines[0];
			lines = lines.splice(1);
		}

		lines.forEach(line => {
			const elems = this.unquote(line.split(';'));
			var entry = this.parseEntry(line, elems);
			this.addEntry(entry);
			lineCounts++;
		})
	}

	getData() {
		return this.data;
	}

	parseEntry(orig, elems) {
		var entry = {};
		entry.rawdata = orig;

		// date
		entry.date = moment(elems[this.schema.fields.date], this.schema.date_format).toDate();
		if (isNaN(entry.date)) throw `couldn't parse date '${elems[this.schema.fields.date]}', check your format: ${this.schema.date_format}`;
		
		// amount
		var rawAmount = elems[this.schema.fields.amount];
		if (this.schema.comma_as_point) {
			rawAmount = rawAmount.replace('.', '').replace(',', '.') // and comma used as floating point
		}

		entry.amount = parseFloat(rawAmount);
		if (isNaN(entry.amount)) throw `couldn't parse amount '${elems[this.schema.fields.amount]}'`;
		
		// type
		entry.type = 0; // will be default if not found
		var found = false;
		var type = elems[this.schema.fields.type];
		this.schema.type_regexps.forEach(r => {
			if (found) return;

			var re = new RegExp(r[0]);

			if (type.match(re)) {
				entry.type = r[1];
				found = true;
			}
		});

		// just text fields, could be empty (theoretically)
		entry.company = elems[this.schema.fields.company];
		entry.description = elems[this.schema.fields.description];
		
		return entry;
	}

	addEntry(entry) {
		if (this.schema.inverse_order) this.data.entries.unshift(entry);
		else                           this.data.entries.push(entry);
	}

	// utils
	unquote(array) {
		var rv = [];
		array.forEach(e => {
			rv.push(e.replace(/^"(.*)"$/, '$1'));
		});
		
		return rv;
	}
}

module.exports = CsvParser;