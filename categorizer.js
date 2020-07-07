'use strict';


const fs = require('fs');
const chalk = require('chalk');
const moment = require('moment');
const readlineSync = require('readline-sync');
const { AutoComplete } = require('enquirer');

const { exit } = require('process');
const { type } = require('os');

const DecisionsFilename = 'config/categories.json';

async function asyncForEach(array, callback) {
	for (let index = 0; index < array.length; index++) {
	  await callback(array[index], index, array);
	}
}

class TransactionMatcher {
	constructFromRes(companyRe, descriptionRe) {
		this.companyRe = new RegExp(companyRe);
		this.descriptionRe = new RegExp(descriptionRe);
	}

	constructFromStruct(struct) {
		this.constructFromRes(struct.company, struct.description);
	}

	constructor(a, b) {
		if (typeof(a) === 'string' && typeof(b) === 'string') {
			this.constructFromRes(a, b);
		} else
		if (typeof(a) == 'object' && 'company' in a && 'description' in a) {
			this.constructFromStruct(a);
		} else {
			throw `Strange arguments in ctor of TransactionMatcher: ${JSON.stringify(a)}, ${JSON.stringify(b)}`;
		}
	}

	match(tran) {
		var m =
				tran.company.match(this.companyRe) &&
				tran.description.match(this.descriptionRe);
		return m;
	}
}

class Categorizer {
	constructor(categories_list) {
		this.categories = categories_list;
		this.loadDecisions();
	}
	
	loadDecisions() {
		if (fs.existsSync(DecisionsFilename)) {
			this.decisions = JSON.parse(fs.readFileSync(DecisionsFilename));
			if (!Array.isArray(this.decisions)) throw `couldn't parse categories from file: ${DecisionsFilename}, should be array`;
		} else {
			this.decisions = [];
		}
		console.log(`${this.decisions.length} known decisions were load from file`);
	}

	addCategory(cat) {
		this.decisions.push(cat);
		fs.writeFileSync(DecisionsFilename, JSON.stringify(this.decisions, null, '\t'));
	}

	applyCategory(tran, cat) {
		tran.category = cat.category;
		tran.description = cat.description;
		tran.memo = cat.memo;
	}

	async categorize(data) {
		console.log(`Input data contains ${data.entries.length} entries`);

		var conflicted = [];
		var notFound = [];

		// go trough all transactions and search for mathing category
		data.entries.forEach((tran, tranIndex) => {
			var foundCategories = [];
			
			// search matching categories for user file first, then in the cache
			this.decisions.forEach(cat => {
				var m = new TransactionMatcher(cat);
				if (m.match(tran)) foundCategories.push(cat);	
			});

			// only one cat => found, put description into the field. Else put it to conflicts or not found depending on result
			if      (foundCategories.length === 0) notFound.push(tranIndex);
			else if (foundCategories.length === 1) this.applyCategory(tran, foundCategories[0]);
			else                                   conflicted.push({entryIndex: tranIndex, matchingCategories: foundCategories});
		});

		// if everything ok, we are done
		if (conflicted.length === 0 && notFound.length === 0) return data;

		// else, ask user for input data
		await this.processWithUser(conflicted, notFound, data);

		// post-process transactions
		this.postProcess(data);
	}

	postProcess(data) {
		data.entries.forEach(e => {
			if (!e.tags) e.tags = [];

			if (e.category === null) { // null categories are UNDONE transactions, mark them with the tag
				e.category = '';
				e.memo = e.raw;
				e.tags.push('UNDONE');
			}
		});
	}

	async processWithUser(conflicted, notFound, data) {
		// process conflicted, user can chose existing category or skip it for the next step here
		var toBeEnteredByUser = [];
		if (conflicted.length > 0) toBeEnteredByUser = this.processConflicts(conflicted, data);

		// just merge skipped at the previous step and not found at all. They all need to be defined by the user now
		toBeEnteredByUser = toBeEnteredByUser.concat(notFound);
		if (toBeEnteredByUser.length > 0) await this.processNotFound(toBeEnteredByUser, data);
	}

	processConflicts(conflicted, data) {
		var rvNotFound = [];
		
		console.log(chalk.yellow(`We have ${conflicted.length} conflicts, let's process them:`));
		
		conflicted.forEach((c, i) => {
			// possible conflicted categories are stored in struct, prepare text array for readline
			var matchingCategoriesFormatted = [];
			c.matchingCategories.forEach(c => {
				matchingCategoriesFormatted.push(`${c.category} (${c.memo})`);
			});

			console.log(`\n${chalk.green(`CONFLICT ${i+1}/${conflicted.length}:`)}\n${this.printTransaction(data.entries[c.entryIndex])}\nis mathing to several categories. Please select the right one.`);
			var index = readlineSync.keyInSelect(matchingCategoriesFormatted, 'Select desired category.', {cancel: 'SKIP. (You can enter another value on furter step)'});
			if (index === -1) {
				console.log(chalk.yellow('Transaction skipped and will be processed later'));
				rvNotFound.push(c.entryIndex);
				return;
			}
			var choice = c.matchingCategories[index];
			console.log(chalk.green(`Transaction marked as '${choice.category} (${choice.memo})'`));
			this.applyCategory(data.entries[i], choice);
		});

		return rvNotFound;
	}
	
	async processNotFound(toBeEnteredByUser, data) {
		/// we have entries without any decision (skipped and unknown). We precess them here
		///   toBeEnteredByUser - array of transaction indexes need to be processed
		// 	  data              - transactions

		readlineSync.setDefaultOptions({defaultInput: ''});

		console.log(chalk.yellow(`\n\nWe have ${toBeEnteredByUser.length} entities with undefined categories, let's process them:`));
		
		const ImportAsUndone = 'IMPORT AS UNDONE'; // some transactions can't be imported in homeBank (e.g. Internal Transfers). We import them marked and change manually
		const NewCategory    = 'NEW CATEGORY';     // item for creating new category by the user
		
		var that = this;
		await asyncForEach(toBeEnteredByUser, async(e, i) => {
			const prompt = new AutoComplete({
				name: 'categories',
				message: 'Pick the category:',
				limit: 20,
				choices: [ImportAsUndone, NewCategory].concat(that.categories)
			});
			
			var tran = data.entries[e];
			var catName = '';

			console.log(`\n${chalk.green(`TRANSACTION ${i+1}/${toBeEnteredByUser.length}:`)}\n ${this.printTransaction(tran)}: `);

			try {
				console.log('\n');
				catName = await prompt.run();
			} catch(e) {
				console.log(chalk.red('Interrupted'));
				process.exit(1);
			}
			
			var cat = {};
			var saveDecision = false;

			if (catName === ImportAsUndone) {
				cat.category = null;
			} else
			if (catName === NewCategory) {
				cat.category = readlineSync.question('Enter the category: ');
			} else {
				cat.category = catName;
			}

			if (readlineSync.keyInYN(chalk.yellow('Remember this decision?'))) {	
				cat.company     = readlineSync.question('Company mask (regexp): '),
				cat.description = readlineSync.question('Description mask (regexp): ')
				saveDecision = true;
			}

			cat.memo = readlineSync.question('Enter memo: ');

			if (saveDecision) this.addCategory(cat);

			this.applyCategory(tran, cat);
		});
	}

	// helpers
	printTransaction(tran) {
		var colorizeAmount = function(val) {
			if (val > 0) return chalk.green(val.toString());
			if (val < 0) return chalk.red  (val.toString());

			return chalk.white(val.toString());
		}

		return `\
${chalk.yellow('Type: ')}        ${chalk.white(tran.type)}\n\		
${chalk.yellow('Company: ')}     ${chalk.white(tran.company)}\n\
${chalk.yellow('Description: ')} ${chalk.white(tran.description)}\n\
${chalk.yellow('Amount: ')}      ${colorizeAmount(tran.amount)}\n\
${chalk.yellow('Date:')}         ${chalk.white(moment(tran.date).format('DD-MM-YYYY'))}`;
	}
}

module.exports = Categorizer;