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
}

export default APIFunctionality;