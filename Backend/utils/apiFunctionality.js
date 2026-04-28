class APIFunctionality {
    constructor(query, queryStr) {
        this.query = query;
        this.queryStr = queryStr;
    }

    search() {
        const Keyword = this.queryStr.keyword ? {
            name: {
                $regex: this.queryStr.keyword,
                $options: 'i',
            }
        } : {};

        this.query = this.query.find({ ...Keyword });
        
        return this;
    }

    filter() {
        const queryCopy = { ...this.queryStr };

        const removeFields = ['keyword', 'page', 'limit'];
        removeFields.forEach((key) => delete queryCopy[key]);

        // FIX #2: Sanitize remaining fields before passing to .find().
        // Blocks two NoSQL injection vectors:
        //   1. Top-level operator keys  e.g. ?$where=...
        //   2. Nested operator values   e.g. ?price[$gt]=0  → { price: { $gt: 0 } }
        const sanitized = {};
        for (const [key, value] of Object.entries(queryCopy)) {
            if (key.startsWith('$')) continue;
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                const hasOperator = Object.keys(value).some(k => k.startsWith('$'));
                if (hasOperator) continue;
            }
            sanitized[key] = value;
        }

        this.query = this.query.find(sanitized);
        
        return this;
    }

    pagination(resultPerPage) {
        const currentPage = Number(this.queryStr.page) || 1;
        const skip = resultPerPage * (currentPage - 1);

        this.query = this.query.limit(resultPerPage).skip(skip);
        return this;
    }
}

export default APIFunctionality;