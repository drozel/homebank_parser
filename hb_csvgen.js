/*
Homebank format (http://homebank.free.fr/help/index.html):

1. date	the date format can be:
y-m-d
m-d-y
d-m-y
year can be 2 or 4 digits
separators can be / . or -

2. payment	 You cannot import transaction with payment type=5 (internal xfer)
from 0=none to 10=FI fee (in the same order of the list)
3. info	a string
4. payee	a payee name
5. memo	a string
6. amount	a number with a '.' or ',' as decimal separator, ex: -24.12 or 36,75
7. category	a full category name (category, or category:subcategory)
8. tags	tags separated by space
tag is mandatory since v4.5
Example:

15-02-04;0;;;Some cash;-40,00;Bill:Withdrawal of cash;tag1 tag2
15-02-04;1;  ;;Internet DSL;-45,00;Inline service/Internet;tag2 my-tag3
20-07-01;  10;;Rad;-52.5;Tazes;


*/

const moment = require('moment');

class HomeBankCsvGen {
	generate(data) {
		var entries = [];

		data.entries.forEach(e => {
			var elements = [];

			elements.push(moment(e.date).format('YY-MM-DD')); // we take the first format
			elements.push(e.type.toString());
			elements.push(''); // no info (I don't know how to use it, memo is enough)
			elements.push(''); // also no payee
			elements.push(e.memo);
			elements.push(e.amount.toString());
			elements.push(e.category);
			
			if (e.tags) elements.push(e.tags.join(' '));
			else        elements.push('');

			entries.push(elements.join(';'));
		});

		return entries.join('\n');
	}
}

module.exports = HomeBankCsvGen;